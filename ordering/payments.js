import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {validateOrder} from './validation.js';
import {validateProfile} from './accounts.js';
const parseJson=objValue=>typeof objValue==='string'?JSON.parse(objValue):objValue;
const digest=strValue=>createHash('sha256').update(strValue).digest('hex');
const fail=(nStatus,strMessage)=>{throw Object.assign(new Error(strMessage),{status:nStatus});};
function hasToken(strToken){return typeof strToken==='string'&&/^[a-f0-9]{64}$/.test(strToken);}
export function canonicalCheckout(objPayload,objIdentity){
 const objCustomer=validateProfile(objIdentity||objPayload?.customer);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(objPayload?.requestKey||''))fail(400,'Invalid checkout key.');
 if(!hasToken(objPayload.checkoutToken))fail(400,'Invalid checkout access token.');
 for(const strKey of ['pizzas','sides','drinks'])if(!Array.isArray(objPayload[strKey])||objPayload[strKey].length>20)fail(400,'Invalid order selections.');
 return {requestKey:objPayload.requestKey,customer:objCustomer,pizzas:objPayload.pizzas.map(objPizza=>({size:objPizza?.size,toppings:Array.isArray(objPizza?.toppings)?[...objPizza.toppings].sort():null})),sides:objPayload.sides.map(objSide=>({name:objSide?.name,quantity:objSide?.quantity})),drinks:objPayload.drinks.map(objDrink=>({name:objDrink?.name,size:objDrink?.size,quantity:objDrink?.quantity}))};
}
export function makeQuote(objPayload,mapMenu,nTaxBasisPoints){
 if(!Number.isInteger(nTaxBasisPoints)||nTaxBasisPoints<0||nTaxBasisPoints>10000)fail(503,'Tax configuration is invalid.');
 let objData;try{objData=validateOrder(objPayload,mapMenu);}catch{fail(400,'Please check the order selections.');}
 const nTax=Math.floor((objData.total*nTaxBasisPoints+5000)/10000),nTotal=objData.total+nTax;
 if(!Number.isSafeInteger(nTotal)||nTotal<50||nTotal>99999999)fail(400,'Online order total must be between $0.50 and $999,999.99.');
 return {customer:objData.customer,items:objData.items,subtotalCents:objData.total,taxCents:nTax,totalCents:nTotal};
}
export function verifyPaidSession(objSession,objPayment){
 const objQuote=parseJson(objPayment.quote_json);
 if(objSession.metadata?.integration!=='luigi-checkout-v2'||objSession.metadata?.payment_id!==objPayment.id||objSession.client_reference_id!==objPayment.id||objSession.metadata?.request_key!==objPayment.request_key)fail(400,'Payment metadata mismatch.');
 if(objPayment.stripe_session_id&&objPayment.stripe_session_id!==objSession.id)fail(409,'Payment session mismatch.');
 if(objSession.mode!=='payment'||objSession.currency!=='usd'||Number(objSession.amount_total)!==objQuote.totalCents)fail(400,'Payment amount or currency mismatch.');
 if(objSession.status!=='complete'||objSession.payment_status!=='paid')fail(409,'Payment has not completed.');
 if(typeof objSession.payment_intent!=='string'||!/^pi_[A-Za-z0-9]+$/.test(objSession.payment_intent))fail(400,'Payment intent is missing.');
 return objQuote;
}
export function createPaymentService(objPool,objStripe,objConfig){
 const strOrigin=new URL(objConfig.siteUrl).origin;
 function requireConfigured(){if(!objStripe)fail(503,'Payment verification is temporarily unavailable. Do not submit another payment.');}
 function requireEnabled(){requireConfigured();if(!objConfig.enabled)fail(503,'Online payment is unavailable. Please choose payment at pickup.');}
 async function transaction(fnWork){const objConnection=await objPool.getConnection();try{await objConnection.beginTransaction();const objResult=await fnWork(objConnection);await objConnection.commit();return objResult;}catch(objError){await objConnection.rollback();throw objError;}finally{objConnection.release();}}
 function authorize(objPayment,strToken,objIdentity){
  if(!hasToken(strToken)||!timingSafeEqual(Buffer.from(digest(strToken),'hex'),Buffer.from(objPayment.access_token_hash,'hex')))fail(404,'Checkout not found.');
  if(objPayment.account_id!==null&&String(objPayment.account_id)!==String(objIdentity?.id))fail(403,'Sign in to the account that started this checkout.');
 }
 async function getPayment(strKey){if(typeof strKey!=='string'||!/^[a-f0-9-]{36}$/i.test(strKey))fail(400,'Invalid checkout key.');const [objPayment]=await objPool.query('SELECT * FROM stripe_payments WHERE request_key=?',[strKey]);if(!objPayment)fail(404,'Checkout not found.');return objPayment;}
 async function reserveCheckoutKey(strKey,strChannel,objIdentity){
  if(typeof strKey!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(strKey)||!['pickup','stripe'].includes(strChannel))fail(400,'Invalid checkout key.');
  await transaction(async objConnection=>{
   await objConnection.query('INSERT INTO checkout_reservations(request_key,channel,account_id) VALUES(?,?,?) ON DUPLICATE KEY UPDATE request_key=request_key',[strKey,strChannel,objIdentity?.id||null]);
   const [objReservation]=await objConnection.query('SELECT channel,account_id FROM checkout_reservations WHERE request_key=? FOR UPDATE',[strKey]);
   if(objReservation.channel!==strChannel||String(objReservation.account_id??null)!==String(objIdentity?.id??null))fail(409,'This key belongs to a different checkout. Check its payment before starting a new order.');
   const [objOrder]=await objConnection.query('SELECT payment_method FROM orders WHERE request_key=?',[strKey]);
   if(objOrder&&(strChannel==='stripe'||['card','online'].includes(objOrder.payment_method))){
    const [objPayment]=await objConnection.query('SELECT * FROM stripe_payments WHERE request_key=?',[strKey]);
    if(strChannel!=='stripe'||!objPayment)fail(409,'This key belongs to an earlier order. Start a new checkout.');
   }
  });
 }
 async function receipt(objConnection,nOrderId){
  const [objOrder]=await objConnection.query('SELECT * FROM orders WHERE id=?',[nOrderId]);
  if(!objOrder)fail(503,'Paid receipt is temporarily unavailable.');
  const arrItems=await objConnection.query('SELECT kind,description,quantity,unit_price_cents AS unit FROM order_items WHERE order_id=? ORDER BY id',[nOrderId]);
  return {orderId:objOrder.id,orderNumber:`LP-${objOrder.id}`,customer:{name:objOrder.customer_name,email:objOrder.customer_email,phone:objOrder.customer_phone},items:arrItems,subtotalCents:objOrder.subtotal_cents,taxCents:objOrder.tax_cents,totalCents:objOrder.total_cents,paymentMethod:'online',paymentStatus:objOrder.payment_status,refundedCents:objOrder.refunded_cents||0,trackerUrl:`${strOrigin}/track?token=${objOrder.tracking_token}`};
 }
 async function attachSession(objPayment){
  if(objPayment.stripe_session_id)return objStripe.checkout.sessions.retrieve(objPayment.stripe_session_id);
  if(new Date(objPayment.expires_at).getTime()<=Date.now())fail(410,'Checkout expired. Start a new order.');
  const objSession=await objStripe.checkout.sessions.create(parseJson(objPayment.params_json),{idempotencyKey:'luigi-checkout-'+objPayment.id});
  await objPool.query("UPDATE stripe_payments SET stripe_session_id=?,state=IF(order_id IS NULL,'open',state) WHERE id=? AND (stripe_session_id IS NULL OR stripe_session_id=?)",[objSession.id,objPayment.id,objSession.id]);
  return objSession;
 }
 async function createCheckout(objPayload,objIdentity){
  requireEnabled();const objCanonical=canonicalCheckout(objPayload,objIdentity),strInputHash=digest(JSON.stringify(objCanonical));
  await reserveCheckoutKey(objCanonical.requestKey,'stripe',objIdentity);
  let [objExisting]=await objPool.query('SELECT * FROM stripe_payments WHERE request_key=?',[objCanonical.requestKey]);
  if(objExisting){authorize(objExisting,objPayload.checkoutToken,objIdentity);if(objExisting.input_hash!==strInputHash)fail(409,'Checkout selections changed. Resume the original payment or start a new order.');}
  else{
   const arrMenu=await objPool.query('SELECT category,name,price_cents FROM menu_prices WHERE is_active = 1');
   const objQuote=makeQuote(objCanonical,new Map(arrMenu.map(objRow=>[`${objRow.category}:${objRow.name}`,Number(objRow.price_cents)])),objConfig.taxBasisPoints);
   const strId=randomUUID(),nExpires=Math.floor(Date.now()/1000)+3600;
   const objParams={mode:'payment',payment_method_types:['card'],customer_email:objQuote.customer.email,client_reference_id:strId,metadata:{integration:'luigi-checkout-v2',payment_id:strId,request_key:objCanonical.requestKey},payment_intent_data:{receipt_email:objQuote.customer.email,metadata:{integration:'luigi-checkout-v2',payment_id:strId,request_key:objCanonical.requestKey}},success_url:`${strOrigin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${strOrigin}/?checkout=cancelled`,expires_at:nExpires,line_items:objQuote.items.map(objItem=>({price_data:{currency:'usd',unit_amount:objItem.unit,product_data:{name:objItem.description}},quantity:objItem.quantity}))};
   if(objQuote.taxCents)objParams.line_items.push({price_data:{currency:'usd',unit_amount:objQuote.taxCents,product_data:{name:'Order tax'}},quantity:1});
   await transaction(async objConnection=>{
    await objConnection.query("INSERT INTO stripe_payments(id,request_key,account_id,access_token_hash,input_hash,quote_json,params_json,expires_at) VALUES(?,?,?,?,?,?,?,TIMESTAMPADD(SECOND,?,'1970-01-01 00:00:00')) ON DUPLICATE KEY UPDATE request_key=request_key",[strId,objCanonical.requestKey,objIdentity?.id||null,digest(objPayload.checkoutToken),strInputHash,JSON.stringify(objQuote),JSON.stringify(objParams),nExpires]);
    const [objCurrent]=await objConnection.query('SELECT * FROM stripe_payments WHERE request_key=? FOR UPDATE',[objCanonical.requestKey]);authorize(objCurrent,objPayload.checkoutToken,objIdentity);if(objCurrent.input_hash!==strInputHash)fail(409,'Checkout selections changed. Start a new order.');
   });
   objExisting=await getPayment(objCanonical.requestKey);
  }
  if(objExisting.order_id)return {state:'paid',receipt:await receipt(objPool,objExisting.order_id)};
  const objSession=await attachSession(objExisting);
  if(objSession.status==='complete'&&objSession.payment_status==='paid')return {state:'paid',receipt:await fulfill(objSession.id)};
  if(objSession.status!=='open')fail(410,'Checkout expired or closed. Start a new order.');
  return {state:'open',url:objSession.url,totalCents:parseJson(objExisting.quote_json).totalCents};
 }
 async function fulfill(strSessionId,strEventId=null,strEventType=null){
  requireConfigured();const objSession=await objStripe.checkout.sessions.retrieve(strSessionId);
  if(objSession.metadata?.integration!=='luigi-checkout-v2')return null;
  if(Boolean(objSession.livemode)!==Boolean(objConfig.liveMode))fail(400,'Payment environment mismatch.');
  return transaction(async objConnection=>{
   const [objPayment]=await objConnection.query('SELECT * FROM stripe_payments WHERE id=? FOR UPDATE',[objSession.metadata.payment_id]);if(!objPayment)fail(503,'Payment record is awaiting recovery.');
   const objQuote=verifyPaidSession(objSession,objPayment);
   if(!objPayment.order_id){
    const objCustomer=objQuote.customer;
    await objConnection.query('INSERT INTO customers(first_name,last_name,email,phone) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',[objCustomer.firstName,objCustomer.lastName,objCustomer.email,objCustomer.phone]);
    const [objCustomerRow]=await objConnection.query('SELECT id FROM customers WHERE email=?',[objCustomer.email]);
    const objOrder=await objConnection.query("INSERT INTO orders(request_key,customer_id,customer_name,customer_email,customer_phone,total_cents,payment_method,stripe_session_id,stripe_payment_intent_id,tracking_token,tracking_status,payment_status,subtotal_cents,tax_cents) VALUES(?,?,?,?,?,?,'online',?,?,?,'order_received','paid',?,?)",[objPayment.request_key,objCustomerRow.id,`${objCustomer.firstName} ${objCustomer.lastName}`,objCustomer.email,objCustomer.phone,objQuote.totalCents,objSession.id,objSession.payment_intent,randomBytes(32).toString('hex'),objQuote.subtotalCents,objQuote.taxCents]);
    for(const objItem of objQuote.items)await objConnection.query('INSERT INTO order_items(order_id,kind,description,quantity,unit_price_cents) VALUES(?,?,?,?,?)',[objOrder.insertId,objItem.kind,objItem.description,objItem.quantity,objItem.unit]);
    await objConnection.query("INSERT INTO order_events(order_id,actor_email,event_type,to_status,details) VALUES(?,?,'created','received','Stripe payment verified')",[objOrder.insertId,objCustomer.email]);
    await objConnection.query("UPDATE stripe_payments SET stripe_session_id=?,stripe_payment_intent_id=?,state='paid',order_id=? WHERE id=?",[objSession.id,objSession.payment_intent,objOrder.insertId,objPayment.id]);
    objPayment.order_id=Number(objOrder.insertId);
    const strTracker=`${strOrigin}/track?token=${(await objConnection.query('SELECT tracking_token FROM orders WHERE id=?',[objOrder.insertId]))[0].tracking_token}`;
    const strReceipt=`Receipt LP-${objOrder.insertId}\n${objQuote.items.map(objItem=>`${objItem.quantity} x ${objItem.description}: $${(objItem.unit*objItem.quantity/100).toFixed(2)}`).join('\n')}\nSubtotal: $${(objQuote.subtotalCents/100).toFixed(2)}\nTax: $${(objQuote.taxCents/100).toFixed(2)}\nTotal paid: $${(objQuote.totalCents/100).toFixed(2)}\nTrack your pickup: ${strTracker}`;
    await objConnection.query("INSERT INTO account_mail(id,recipient,subject,message,purpose) VALUES(?,?,?,?,'receipt')",[randomUUID(),objCustomer.email,`Luigi receipt LP-${objOrder.insertId}`,strReceipt]);
   }
   if(strEventId)await objConnection.query('INSERT IGNORE INTO stripe_events(event_id,event_type,payment_id) VALUES(?,?,?)',[strEventId,strEventType,objPayment.id]);
   return receipt(objConnection,objPayment.order_id);
  });
 }
 async function checkoutStatus(objInput,objIdentity){
  requireConfigured();const objPayment=await getPayment(objInput.requestKey);authorize(objPayment,objInput.checkoutToken,objIdentity);
  if(objPayment.order_id)return {state:'paid',receipt:await receipt(objPool,objPayment.order_id)};
  const objSession=await attachSession(objPayment);
  if(objSession.status==='complete'&&objSession.payment_status==='paid')return {state:'paid',receipt:await fulfill(objSession.id)};
  return {state:objSession.status==='expired'?'expired':objSession.status==='open'?'open':'processing'};
 }
 async function synchronizeRefund(objRefund,strEventId,strEventType){
  const strIntent=typeof objRefund.payment_intent==='string'?objRefund.payment_intent:objRefund.payment_intent?.id;
  if(!strIntent)return;
  const objIntent=await objStripe.paymentIntents.retrieve(strIntent);
  if(objIntent.metadata?.integration!=='luigi-checkout-v2')return;
  const strCharge=typeof objIntent.latest_charge==='string'?objIntent.latest_charge:objIntent.latest_charge?.id;
  if(!strCharge)fail(503,'Refund charge is not available.');
  await transaction(async objConnection=>{
   const [objPayment]=await objConnection.query('SELECT * FROM stripe_payments WHERE id=? FOR UPDATE',[objIntent.metadata.payment_id]);if(!objPayment?.order_id)fail(503,'Order fulfillment must complete before refund processing.');
   const objCharge=await objStripe.charges.retrieve(strCharge);
   const objQuote=parseJson(objPayment.quote_json),nRefunded=Number(objCharge.amount_refunded);
   if(objCharge.currency!=='usd'||Number(objCharge.amount)!==objQuote.totalCents||!Number.isSafeInteger(nRefunded)||nRefunded<0||nRefunded>objQuote.totalCents)fail(400,'Refund amount mismatch.');
   // Read the current charge, not the event's old totals, so out-of-order events cannot undo a newer refund.
   const strStatus=nRefunded>=objQuote.totalCents?'refunded':nRefunded>0?'partially_refunded':'paid';
   await objConnection.query('UPDATE orders SET payment_status=?,refunded_cents=? WHERE id=?',[strStatus,nRefunded,objPayment.order_id]);
   await objConnection.query('UPDATE stripe_payments SET refunded_cents=? WHERE id=?',[nRefunded,objPayment.id]);
   if(objRefund.object==='refund')await objConnection.query('INSERT INTO stripe_refunds(stripe_refund_id,payment_id,amount_cents,status) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status)',[objRefund.id,objPayment.id,objRefund.amount,objRefund.status]);
   await objConnection.query('INSERT IGNORE INTO stripe_events(event_id,event_type,payment_id) VALUES(?,?,?)',[strEventId,strEventType,objPayment.id]);
  });
 }
 async function webhook(bufRaw,strSignature){
  requireConfigured();let objEvent;try{objEvent=objStripe.webhooks.constructEvent(bufRaw,strSignature,objConfig.webhookSecret);}catch{fail(400,'Invalid Stripe webhook signature.');}
  if(Boolean(objEvent.livemode)!==Boolean(objConfig.liveMode))fail(400,'Webhook environment mismatch.');
  const objSession=objEvent.data.object;
  if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(objEvent.type)&&objSession.metadata?.integration==='luigi-checkout-v2'){
   if(objSession.payment_status==='paid')await fulfill(objSession.id,objEvent.id,objEvent.type);
  }else if(['checkout.session.expired','checkout.session.async_payment_failed'].includes(objEvent.type)&&objSession.metadata?.integration==='luigi-checkout-v2'){
   // Retrieve current state so a delayed expired/failed event never overwrites a completed payment.
   const objCurrent=await objStripe.checkout.sessions.retrieve(objSession.id);
   if(objCurrent.payment_status==='paid')await fulfill(objCurrent.id,objEvent.id,objEvent.type);
   else await transaction(async objConnection=>{const [objPayment]=await objConnection.query('SELECT * FROM stripe_payments WHERE id=? FOR UPDATE',[objCurrent.metadata.payment_id]);if(!objPayment)return;if(!objPayment.order_id)await objConnection.query('UPDATE stripe_payments SET state=? WHERE id=?',[objCurrent.status==='expired'?'expired':'failed',objPayment.id]);await objConnection.query('INSERT IGNORE INTO stripe_events(event_id,event_type,payment_id) VALUES(?,?,?)',[objEvent.id,objEvent.type,objPayment.id]);});
  }else if(['charge.refunded','refund.updated','refund.failed','refund.created'].includes(objEvent.type))await synchronizeRefund(objSession,objEvent.id,objEvent.type);
  return {received:true};
 }
 async function reconcile(){requireConfigured();const arrPayments=await objPool.query("SELECT * FROM stripe_payments WHERE order_id IS NULL AND state IN ('creating','open','failed') AND (stripe_session_id IS NOT NULL OR expires_at>UTC_TIMESTAMP()) ORDER BY created_at LIMIT 100");let nRecovered=0;for(const objPayment of arrPayments){try{const objSession=await attachSession(objPayment);if(objSession.payment_status==='paid'){if(await fulfill(objSession.id))nRecovered++;}else if(objSession.status==='expired')await objPool.query("UPDATE stripe_payments SET state='expired' WHERE id=? AND order_id IS NULL",[objPayment.id]);}catch(objError){console.error('Stripe reconciliation needs attention:',objPayment.id,objError.code||objError.status||objError.name);}}return {checked:arrPayments.length,recovered:nRecovered};}
 return {createCheckout,checkoutStatus,fulfill,webhook,reconcile,reserveCheckoutKey};
}
