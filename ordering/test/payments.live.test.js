import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPaymentService} from '../payments.js';
test('live MariaDB Stripe quote, paid fulfillment, receipt email, retry and rollback',{skip:process.env.RUN_DB_TEST!=='1'},async()=>{
 const {default:objDriver}=await import('mariadb');
 const objConnection=await objDriver.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'luigis',bigIntAsNumber:true,timezone:'Z'});
 const strKey=randomUUID(),strEmail='stripe-db-test-'+strKey+'@example.invalid';
 try{
  await objConnection.beginTransaction();
  // Savepoints let production transactions run while the outer test rolls every record back.
  const objPool={query:objConnection.query.bind(objConnection),getConnection:async()=>({query:objConnection.query.bind(objConnection),beginTransaction:()=>objConnection.query('SAVEPOINT stripe_live_test'),commit:()=>objConnection.query('RELEASE SAVEPOINT stripe_live_test'),rollback:()=>objConnection.query('ROLLBACK TO SAVEPOINT stripe_live_test'),release(){}})};
  let objSession;const objStripe={checkout:{sessions:{async create(objParams){objSession={id:'cs_test_db_'+strKey.replaceAll('-',''),metadata:objParams.metadata,client_reference_id:objParams.client_reference_id,mode:'payment',currency:'usd',livemode:false,status:'open',payment_status:'unpaid',payment_intent:null,url:'https://checkout.stripe.com/c/pay/test',amount_total:objParams.line_items.reduce((nSum,objItem)=>nSum+objItem.quantity*objItem.price_data.unit_amount,0)};return objSession;},async retrieve(){return objSession;}}}};
  const objService=createPaymentService(objPool,objStripe,{enabled:true,liveMode:false,siteUrl:'http://127.0.0.1:3000',taxBasisPoints:0});
  const objInput={requestKey:strKey,checkoutToken:'a'.repeat(64),customer:{firstName:'Database',lastName:'Stripe',email:strEmail,phone:'5551234567'},pizzas:[{size:'Small',toppings:[]}],sides:[],drinks:[]};
  await objService.createCheckout(objInput,null);assert.equal((await objService.checkoutStatus(objInput,null)).state,'open');
  objSession.status='complete';objSession.payment_status='paid';objSession.payment_intent='pi_db_'+strKey.replaceAll('-','');
  const objFirst=await objService.fulfill(objSession.id,'evt_db_'+strKey,'checkout.session.completed');const objAgain=await objService.fulfill(objSession.id,'evt_db_'+strKey,'checkout.session.completed');assert.equal(objFirst.orderId,objAgain.orderId);assert.equal(objFirst.paymentStatus,'paid');assert.match(objFirst.trackerUrl,/token=/);
  const [objCount]=await objConnection.query('SELECT COUNT(*) AS n FROM orders WHERE request_key=?',[strKey]);assert.equal(Number(objCount.n),1);
  const [objMail]=await objConnection.query("SELECT COUNT(*) AS n FROM account_mail WHERE recipient=? AND purpose='receipt'",[strEmail]);assert.equal(Number(objMail.n),1);
  await objConnection.rollback();const arrLeft=await objConnection.query('SELECT id FROM stripe_payments WHERE request_key=?',[strKey]);assert.equal(arrLeft.length,0);
 }finally{await objConnection.rollback();await objConnection.end();}
});
