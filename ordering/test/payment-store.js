// Transactional test adapter only; production always uses MariaDB.
export function paymentStore(){
 let objState={payments:[],customers:[],orders:[],items:[],events:new Map(),refunds:new Map(),mail:[],reservations:new Map()};
 let prLock=Promise.resolve();const mapMenu=new Map([['pizza:Small',1000],['pizza:Medium',1300],['pizza:Large',1600],['topping:Cheese',150],['side:Breadsticks',500],['side:Pizza Bites',600],['drink:Small',200],['drink:Medium',275],['drink:Large',350],['drink_name:Coke',0],['drink_name:Pepsi',0],['drink_name:Dr Pepper',0],['drink_name:Water',0]]);
 const objFlags={failItems:false};
 const copy=objValue=>structuredClone(objValue);
 async function query(strSql,arrValues=[]){
  if(strSql.startsWith('SELECT category'))return [...mapMenu].map(([strKey,nValue])=>({category:strKey.split(':')[0],name:strKey.split(':')[1],price_cents:nValue}));
  if(strSql.startsWith('INSERT INTO checkout_reservations')){if(!objState.reservations.has(arrValues[0]))objState.reservations.set(arrValues[0],{channel:arrValues[1],account_id:arrValues[2]});return {};}
  if(strSql.startsWith('SELECT channel,account_id FROM checkout_reservations'))return objState.reservations.has(arrValues[0])?[copy(objState.reservations.get(arrValues[0]))]:[];
  if(strSql.startsWith('SELECT payment_method FROM orders'))return copy(objState.orders.filter(objRow=>objRow.request_key===arrValues[0]).map(objRow=>({payment_method:objRow.payment_method})));
  if(strSql.startsWith('SELECT * FROM stripe_payments WHERE request_key'))return copy(objState.payments.filter(objRow=>objRow.request_key===arrValues[0]));
  if(strSql.startsWith('SELECT * FROM stripe_payments WHERE id'))return copy(objState.payments.filter(objRow=>objRow.id===arrValues[0]));
  if(strSql.startsWith('INSERT INTO stripe_payments')){if(!objState.payments.some(objRow=>objRow.request_key===arrValues[1]))objState.payments.push({id:arrValues[0],request_key:arrValues[1],account_id:arrValues[2],access_token_hash:arrValues[3],input_hash:arrValues[4],quote_json:arrValues[5],params_json:arrValues[6],expires_at:new Date(arrValues[7]*1000),stripe_session_id:null,stripe_payment_intent_id:null,order_id:null,state:'creating',refunded_cents:0});return {};}
  if(strSql.startsWith('UPDATE stripe_payments SET stripe_session_id=?,stripe_payment_intent_id=')){const objRow=objState.payments.find(objPayment=>objPayment.id===arrValues[3]);Object.assign(objRow,{stripe_session_id:arrValues[0],stripe_payment_intent_id:arrValues[1],order_id:Number(arrValues[2]),state:'paid'});return {affectedRows:1};}
  if(strSql.startsWith('UPDATE stripe_payments SET stripe_session_id=')){const objRow=objState.payments.find(objPayment=>objPayment.id===arrValues[1]);objRow.stripe_session_id=arrValues[0];if(!objRow.order_id)objRow.state='open';return {affectedRows:1};}
  if(strSql.startsWith('UPDATE stripe_payments SET refunded_cents')){objState.payments.find(objRow=>objRow.id===arrValues[1]).refunded_cents=arrValues[0];return {};}
  if(strSql.startsWith('UPDATE stripe_payments SET state=?')){objState.payments.find(objRow=>objRow.id===arrValues[1]).state=arrValues[0];return {};}
  if(strSql.startsWith('INSERT INTO customers')){if(!objState.customers.some(objRow=>objRow.email===arrValues[2]))objState.customers.push({id:objState.customers.length+1,first_name:arrValues[0],last_name:arrValues[1],email:arrValues[2],phone:arrValues[3]});return {};}
  if(strSql.startsWith('SELECT id FROM customers'))return copy(objState.customers.filter(objRow=>objRow.email===arrValues[0]).map(objRow=>({id:objRow.id})));
  if(strSql.startsWith('INSERT INTO orders')){if(objState.orders.some(objRow=>objRow.request_key===arrValues[0]))throw Object.assign(Error(),{code:'ER_DUP_ENTRY'});const objOrder={id:objState.orders.length+1,request_key:arrValues[0],customer_id:arrValues[1],customer_name:arrValues[2],customer_email:arrValues[3],customer_phone:arrValues[4],total_cents:arrValues[5],stripe_session_id:arrValues[6],stripe_payment_intent_id:arrValues[7],tracking_token:arrValues[8],subtotal_cents:arrValues[9],tax_cents:arrValues[10],payment_method:'online',payment_status:'paid',refunded_cents:0,tracking_status:'order_received'};objState.orders.push(objOrder);return {insertId:objOrder.id};}
  if(strSql.startsWith('INSERT INTO order_items')){if(objFlags.failItems)throw Error('Injected database failure');objState.items.push({order_id:Number(arrValues[0]),kind:arrValues[1],description:arrValues[2],quantity:arrValues[3],unit:arrValues[4]});return {};}
  if(strSql.startsWith('INSERT INTO order_events'))return {};
  if(strSql.startsWith('SELECT * FROM orders')||strSql.startsWith('SELECT tracking_token FROM orders'))return copy(objState.orders.filter(objRow=>objRow.id===Number(arrValues[0])));
  if(strSql.startsWith('SELECT kind,description'))return copy(objState.items.filter(objRow=>objRow.order_id===Number(arrValues[0])).map(({kind,description,quantity,unit})=>({kind,description,quantity,unit})));
  if(strSql.startsWith('INSERT INTO account_mail')){objState.mail.push({id:arrValues[0],recipient:arrValues[1],subject:arrValues[2],message:arrValues[3]});return {};}
  if(strSql.startsWith('INSERT IGNORE INTO stripe_events')){objState.events.set(arrValues[0],{type:arrValues[1],payment_id:arrValues[2]});return {};}
  if(strSql.startsWith('UPDATE orders SET payment_status')){Object.assign(objState.orders.find(objRow=>objRow.id===Number(arrValues[2])),{payment_status:arrValues[0],refunded_cents:arrValues[1]});return {};}
  if(strSql.startsWith('INSERT INTO stripe_refunds')){objState.refunds.set(arrValues[0],{payment_id:arrValues[1],amount_cents:arrValues[2],status:arrValues[3]});return {};}
  throw Error('Unexpected payment test query: '+strSql);
 }
 const objPool={query,getConnection:async()=>{let objSaved,fnRelease,bOpen=false;return {query,async beginTransaction(){const prPrevious=prLock;prLock=new Promise(fnResolve=>{fnRelease=fnResolve});await prPrevious;objSaved=copy(objState);bOpen=true;},async commit(){bOpen=false;fnRelease();},async rollback(){if(bOpen){objState=objSaved;bOpen=false;fnRelease();}},release(){if(bOpen)throw Error('Transaction not closed');}}}};
 return {pool:objPool,mapMenu,flags:objFlags,get state(){return objState}};
}
