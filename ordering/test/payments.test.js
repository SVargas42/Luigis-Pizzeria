import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import Stripe from 'stripe';
import {createPaymentService,makeQuote,canonicalCheckout,verifyPaidSession} from '../payments.js';
import {paymentStore} from './payment-store.js';
const objStripeSdk=new Stripe('sk_test_unit_only');
function harness(){
 const objStore=paymentStore(),mapSessions=new Map(),mapKeys=new Map();let nCalls=0,nRefunded=0;
 const objStripe={webhooks:objStripeSdk.webhooks,checkout:{sessions:{async create(objParams,objOptions){nCalls++;if(mapKeys.has(objOptions.idempotencyKey))return structuredClone(mapSessions.get(mapKeys.get(objOptions.idempotencyKey)));const strId='cs_test_'+(mapSessions.size+1),objSession={id:strId,metadata:objParams.metadata,client_reference_id:objParams.client_reference_id,currency:'usd',mode:'payment',status:'open',payment_status:'unpaid',livemode:false,payment_intent:null,amount_total:objParams.line_items.reduce((nSum,objLine)=>nSum+objLine.price_data.unit_amount*objLine.quantity,0),url:'https://checkout.stripe.com/c/pay/'+strId};mapSessions.set(strId,objSession);mapKeys.set(objOptions.idempotencyKey,strId);return structuredClone(objSession);},async retrieve(strId){return structuredClone(mapSessions.get(strId));}}},paymentIntents:{async retrieve(){return {metadata:{integration:'luigi-checkout-v2',payment_id:objStore.state.payments[0].id},latest_charge:'ch_test1'};}},charges:{async retrieve(){return {currency:'usd',amount:JSON.parse(objStore.state.payments[0].quote_json).totalCents,amount_refunded:nRefunded};}}};
 const objService=createPaymentService(objStore.pool,objStripe,{enabled:true,liveMode:false,siteUrl:'https://pizza.example',webhookSecret:'whsec_unit_secret',taxBasisPoints:825});
 const objInput={requestKey:randomUUID(),checkoutToken:'a'.repeat(64),customer:{firstName:'Ada',lastName:'Customer',email:'ada@example.com',phone:'5551234567'},pizzas:[{size:'Small',toppings:['Cheese']}],sides:[],drinks:[],totalCents:1};
 function paid(){const objSession=mapSessions.values().next().value;objSession.status='complete';objSession.payment_status='paid';objSession.payment_intent='pi_test1';return objSession;}
 async function event(strType,objObject,objOverrides={}){const strPayload=JSON.stringify({id:'evt_'+randomUUID(),type:strType,livemode:false,data:{object:objObject},...objOverrides});const strSignature=objStripeSdk.webhooks.generateTestHeaderString({payload:strPayload,secret:'whsec_unit_secret'});return objService.webhook(Buffer.from(strPayload),strSignature);}
 return {objStore,objService,objInput,objStripe,mapSessions,paid,event,setRefunded(nValue){nRefunded=nValue},get calls(){return nCalls}};
}
test('server quote ignores client totals, validates contact and freezes tax with prices',()=>{
 const objHarness=harness(),objCanonical=canonicalCheckout(objHarness.objInput,null),objQuote=makeQuote(objCanonical,objHarness.objStore.mapMenu,825);assert.equal(objQuote.subtotalCents,1150);assert.equal(objQuote.taxCents,95);assert.equal(objQuote.totalCents,1245);
 assert.throws(()=>makeQuote(objCanonical,objHarness.objStore.mapMenu,-1));assert.throws(()=>canonicalCheckout({...objHarness.objInput,customer:{...objHarness.objInput.customer,phone:''}},null));assert.throws(()=>canonicalCheckout({...objHarness.objInput,checkoutToken:'bad'},null));
});
test('Checkout reuses provider idempotency key and unchanged stored quote after menu changes',async()=>{
 const objHarness=harness(),objFirst=await objHarness.objService.createCheckout(objHarness.objInput,null);assert.equal(objFirst.totalCents,1245);assert.equal(objHarness.objStore.state.orders.length,0);
 objHarness.objStore.mapMenu.set('pizza:Small',9000);const objAgain=await objHarness.objService.createCheckout(objHarness.objInput,null);assert.equal(objAgain.url,objFirst.url);assert.equal(objHarness.calls,1);
 await assert.rejects(objHarness.objService.createCheckout({...objHarness.objInput,pizzas:[{size:'Large',toppings:[]}]},null),objError=>objError.status===409);
 await assert.rejects(objHarness.objService.createCheckout({...objHarness.objInput,checkoutToken:'b'.repeat(64)},null),objError=>objError.status===404);
});
test('unpaid and forged success cannot fulfill an order; missing credentials fail closed',async()=>{
 const objHarness=harness();await objHarness.objService.createCheckout(objHarness.objInput,null);assert.equal((await objHarness.objService.checkoutStatus(objHarness.objInput,null)).state,'open');
 await assert.rejects(objHarness.objService.fulfill('cs_test_1'),objError=>objError.status===409);assert.equal(objHarness.objStore.state.orders.length,0);
 await objHarness.event('checkout.session.completed',objHarness.mapSessions.get('cs_test_1'));assert.equal(objHarness.objStore.state.orders.length,0);
 const objDisabled=createPaymentService(objHarness.objStore.pool,null,{enabled:false,siteUrl:'https://pizza.example'});await assert.rejects(objDisabled.createCheckout(objHarness.objInput,null),objError=>objError.status===503);
});
test('webhook and return-page race produce one paid order, one receipt email and one tracker',async()=>{
 const objHarness=harness();await objHarness.objService.createCheckout(objHarness.objInput,null);objHarness.paid();
 const [objFirst,objSecond]=await Promise.all([objHarness.objService.fulfill('cs_test_1','evt_one','checkout.session.completed'),objHarness.objService.fulfill('cs_test_1','evt_one','checkout.session.completed')]);
 assert.deepEqual(objFirst,objSecond);assert.equal(objHarness.objStore.state.orders.length,1);assert.equal(objHarness.objStore.state.mail.length,1);assert.equal(objHarness.objStore.state.events.size,1);assert.equal(objFirst.paymentStatus,'paid');assert.equal(objFirst.totalCents,1245);assert.match(objFirst.trackerUrl,/token=[a-f0-9]{64}$/);assert.equal((await objHarness.objService.checkoutStatus(objHarness.objInput,null)).receipt.orderId,objFirst.orderId);
});
test('paid order transaction failure rolls back every write and webhook retry recovers',async()=>{
 const objHarness=harness();await objHarness.objService.createCheckout(objHarness.objInput,null);objHarness.paid();objHarness.objStore.flags.failItems=true;
 await assert.rejects(objHarness.objService.fulfill('cs_test_1'));assert.equal(objHarness.objStore.state.orders.length,0);assert.equal(objHarness.objStore.state.customers.length,0);assert.equal(objHarness.objStore.state.payments[0].order_id,null);
 objHarness.objStore.flags.failItems=false;await objHarness.event('checkout.session.completed',objHarness.mapSessions.get('cs_test_1'));assert.equal(objHarness.objStore.state.orders.length,1);assert.equal(objHarness.calls,1);
});
test('Stripe SDK rejects modified signatures and wrong-mode events',async()=>{
 const objHarness=harness();await assert.rejects(objHarness.objService.webhook(Buffer.from('{}'),'bad'),objError=>objError.status===400);
 const strPayload=JSON.stringify({id:'evt_old',type:'ignored',livemode:false,data:{object:{}}}),strOld=objStripeSdk.webhooks.generateTestHeaderString({payload:strPayload,secret:'whsec_unit_secret',timestamp:Math.floor(Date.now()/1000)-600});await assert.rejects(objHarness.objService.webhook(Buffer.from(strPayload),strOld),objError=>objError.status===400);
 await assert.rejects(objHarness.event('ignored',{}, {livemode:true}),objError=>objError.status===400);
});
test('signed-in checkout uses server profile and refuses another account history token',async()=>{
 const objHarness=harness(),objActor={id:'7',role:'customer',email:'trusted@example.com',firstName:'Verified',lastName:'User',phone:'5557654321'};
 await objHarness.objService.createCheckout(objHarness.objInput,objActor);const objQuote=JSON.parse(objHarness.objStore.state.payments[0].quote_json);assert.equal(objQuote.customer.email,objActor.email);assert.equal(objHarness.objStore.state.payments[0].account_id,'7');
 await assert.rejects(objHarness.objService.checkoutStatus(objHarness.objInput,null),objError=>objError.status===403);await assert.rejects(objHarness.objService.checkoutStatus(objHarness.objInput,{id:'8'}),objError=>objError.status===403);
});
test('session metadata, amount, currency and provider session substitution are rejected',async()=>{
 const objHarness=harness();await objHarness.objService.createCheckout(objHarness.objInput,null);const objPaid=objHarness.paid(),objRow=objHarness.objStore.state.payments[0];
 for(const objChange of [{currency:'eur'},{amount_total:1},{id:'cs_test_other'},{metadata:{...objPaid.metadata,payment_id:'wrong'}}])assert.throws(()=>verifyPaidSession({...objPaid,...objChange},objRow));
});
test('refund webhooks synchronize actual partial/full/failed totals without cancelling production status',async()=>{
 const objHarness=harness();await objHarness.objService.createCheckout(objHarness.objInput,null);await objHarness.objService.fulfill(objHarness.paid().id);
 objHarness.setRefunded(300);await objHarness.event('refund.updated',{object:'refund',id:'re_one',payment_intent:'pi_test1',amount:300,status:'succeeded'});assert.equal(objHarness.objStore.state.orders[0].payment_status,'partially_refunded');
 objHarness.setRefunded(1245);await objHarness.event('charge.refunded',{object:'charge',id:'ch_test1',payment_intent:'pi_test1',amount_refunded:300});assert.equal(objHarness.objStore.state.orders[0].payment_status,'refunded');assert.equal(objHarness.objStore.state.orders[0].refunded_cents,1245);
 objHarness.setRefunded(300);await objHarness.event('refund.failed',{object:'refund',id:'re_two',payment_intent:'pi_test1',amount:945,status:'failed'});assert.equal(objHarness.objStore.state.orders[0].refunded_cents,300);assert.equal(objHarness.objStore.state.orders[0].tracking_status,'order_received');assert.equal(objHarness.objStore.state.refunds.get('re_two').status,'failed');
});
test('expired/failed events arriving after successful payment do not undo fulfillment',async()=>{
 const objHarness=harness();await objHarness.objService.createCheckout(objHarness.objInput,null);objHarness.paid();await objHarness.event('checkout.session.expired',{...objHarness.mapSessions.get('cs_test_1'),payment_status:'unpaid',status:'expired'});assert.equal(objHarness.objStore.state.orders.length,1);assert.equal(objHarness.objStore.state.payments[0].state,'paid');
});
test('pausing new card checkouts does not stop verification and fulfillment of an existing payment',async()=>{
 const objHarness=harness();await objHarness.objService.createCheckout(objHarness.objInput,null);objHarness.paid();
 const objPaused=createPaymentService(objHarness.objStore.pool,objHarness.objStripe,{enabled:false,liveMode:false,siteUrl:'https://pizza.example',webhookSecret:'whsec_unit_secret'});
 await assert.rejects(objPaused.createCheckout(objHarness.objInput,null),objError=>objError.status===503);assert.equal((await objPaused.checkoutStatus(objHarness.objInput,null)).state,'paid');assert.equal(objHarness.objStore.state.orders.length,1);
});
test('pickup and Stripe cannot concurrently use the same order key',async()=>{
 const objHarness=harness();const arrResults=await Promise.allSettled([objHarness.objService.createCheckout(objHarness.objInput,null),objHarness.objService.reserveCheckoutKey(objHarness.objInput.requestKey,'pickup',null)]);
 assert.equal(arrResults.filter(objResult=>objResult.status==='fulfilled').length,1);assert.equal(arrResults.find(objResult=>objResult.status==='rejected').reason.status,409);
 assert.ok(objHarness.objStore.state.reservations.has(objHarness.objInput.requestKey));
});
test('an old pickup order cannot be charged again under the same request key',async()=>{
 const objHarness=harness();objHarness.objStore.state.orders.push({id:99,request_key:objHarness.objInput.requestKey,payment_method:'in_store'});
 await assert.rejects(objHarness.objService.createCheckout(objHarness.objInput,null),objError=>objError.status===409);assert.equal(objHarness.calls,0);
});
