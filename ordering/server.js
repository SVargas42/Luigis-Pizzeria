import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import {createHmac} from 'node:crypto';
import mariadb from 'mariadb';
import {normalizeEditableItems,validateOrder} from './validation.js';
import {buildSyntheticAnalytics,buildSyntheticBusinessData,buildSyntheticEmployeeData,buildSyntheticItemComparison,canTransitionStatus,orderAttention} from './domain.js';
import {identityIsConfigured,resolveIdentity} from './identity.js';
import {requiresStaffAuthentication} from './admin-access.js';

for (const key of ['DB_PASSWORD','ADMIN_USER','ADMIN_PASSWORD']) {
 if (!process.env[key] || /replace-|PUT_YOUR|CHOOSE_A|YOUR_/i.test(process.env[key])) throw new Error(`Set ${key} in .env before starting.`);
}
const pool = mariadb.createPool({host:process.env.DB_HOST || '127.0.0.1',port:Number(process.env.DB_PORT || 3306),user:process.env.DB_USER || 'luigis_app',password:process.env.DB_PASSWORD,database:process.env.DB_NAME || 'luigis',connectionLimit:5,bigIntAsNumber:true});
const allowedTransitions = {received:['preparing','cancelled'],preparing:['ready','cancelled'],ready:['completed','cancelled'],completed:[],cancelled:[]};
function send(res,status,data) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }
function authorized(req) {
 const supplied = Buffer.from(req.headers.authorization || '');
 const expected = Buffer.from('Basic '+Buffer.from(`${process.env.ADMIN_USER}:${process.env.ADMIN_PASSWORD}`).toString('base64'));
 return supplied.length === expected.length && timingSafeEqual(supplied,expected);
}
async function isAdminRequest(req) {
 const objIdentity=await resolveIdentity(req);
 return objIdentity?.role==='admin' || authorized(req);
}
async function body(req) {
 if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new Error('JSON required');
 let raw='';
 for await (const chunk of req) {raw += chunk; if (Buffer.byteLength(raw)>32768) throw new Error('Request too large');}
 return JSON.parse(raw);
}
async function rawBody(req) {
 let strRaw='';for await(const chunk of req){strRaw+=chunk;if(Buffer.byteLength(strRaw)>65536)throw new Error('Request too large');}return strRaw;
}
async function createOrder(payload,objIdentity=null,stripePaymentIntentId=null,stripeSessionId=null) {
 const conn = await pool.getConnection();
 try {
  await conn.beginTransaction();
  const rows = await conn.query('SELECT category,name,price_cents FROM menu_prices');
  if(objIdentity) payload={...payload,customer:{firstName:objIdentity.firstName,lastName:objIdentity.lastName,email:objIdentity.email,phone:objIdentity.phone}};
  const data = validateOrder(payload,new Map(rows.map(r=>[`${r.category}:${r.name}`,r.price_cents])));
  // Claim the retry key before changing any customer data. Duplicate inserts wait
  // for the original transaction and then return its committed receipt.
  await conn.query('INSERT INTO customers(first_name,last_name,email,phone) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',[data.customer.firstName,data.customer.lastName,data.customer.email,data.customer.phone]);
  const [customer] = await conn.query('SELECT id FROM customers WHERE email=?',[data.customer.email]);
  const result = await conn.query('INSERT INTO orders(request_key,customer_id,customer_name,customer_email,customer_phone,total_cents,payment_method,stripe_session_id,stripe_payment_intent_id) VALUES(?,?,?,?,?,?,?,?,?)',[payload.requestKey,customer.id,`${data.customer.firstName} ${data.customer.lastName}`,data.customer.email,data.customer.phone,data.total,'card',stripeSessionId,stripePaymentIntentId]);
  await conn.query('UPDATE customers SET first_name=?,last_name=?,phone=? WHERE id=?',[data.customer.firstName,data.customer.lastName,data.customer.phone,customer.id]);
  for (const item of data.items) await conn.query('INSERT INTO order_items(order_id,kind,description,quantity,unit_price_cents) VALUES(?,?,?,?,?)',[result.insertId,item.kind,item.description,item.quantity,item.unit]);
  await conn.query("INSERT INTO order_events(order_id,actor_email,event_type,to_status,details) VALUES(?,?,'created','received','Order placed')",[result.insertId,objIdentity?.email || data.customer.email]);
  await conn.commit();
  return {orderNumber:`LP-${result.insertId}`,orderId:result.insertId,totalCents:data.total,items:data.items};
 } catch (error) {
  await conn.rollback();
  if (error.code === 'ER_DUP_ENTRY') {
   const [order] = await conn.query('SELECT id,total_cents FROM orders WHERE request_key=?',[payload.requestKey]);
   if (order) {
    const items = await conn.query('SELECT kind,description,quantity,unit_price_cents AS unit FROM order_items WHERE order_id=? ORDER BY id',[order.id]);
    return {orderNumber:`LP-${order.id}`,orderId:order.id,totalCents:order.total_cents,items};
   }
  }
  throw error;
 } finally {conn.release();}
}
async function stripeRequest(path,params=null,method='POST') {
 const headers={Authorization:`Bearer ${process.env.STRIPE_SECRET_KEY}`};
 const response=await fetch(`https://api.stripe.com/v1/${path}`,{method,headers,...(params?{body:params.toString(),headers:{...headers,'Content-Type':'application/x-www-form-urlencoded'}}:{})});
 const data=await response.json();
 if(!response.ok) throw new Error('Payment provider request failed');
 return data;
}
async function finishPaidCheckout(session) {
 if(session.payment_status!=='paid'||session.currency!=='usd'||!session.metadata?.request_key) throw new Error('Payment is not complete.');
 const [existing]=await pool.query('SELECT id,total_cents FROM orders WHERE stripe_session_id=?',[session.id]);
 if(existing){const items=await pool.query('SELECT kind,description,quantity,unit_price_cents AS unit FROM order_items WHERE order_id=? ORDER BY id',[existing.id]);return {orderNumber:`LP-${existing.id}`,orderId:existing.id,totalCents:existing.total_cents,items};}
 const [pending]=await pool.query('SELECT payload_json,total_cents FROM pending_checkouts WHERE request_key=? AND stripe_session_id=?',[session.metadata.request_key,session.id]);
 if(!pending||Number(session.amount_total)!==Number(pending.total_cents)) throw new Error('Payment could not be verified.');
 const receipt=await createOrder(JSON.parse(pending.payload_json),null,null,session.id);
 await pool.query('DELETE FROM pending_checkouts WHERE request_key=?',[session.metadata.request_key]);
 return receipt;
}
async function finishPaidPaymentIntent(intent) {
 if(intent.status!=='succeeded'||intent.currency!=='usd'||!intent.metadata?.request_key) throw new Error('Payment is not complete.');
 const [existing]=await pool.query('SELECT id,total_cents FROM orders WHERE stripe_payment_intent_id=?',[intent.id]);
 if(existing){const items=await pool.query('SELECT kind,description,quantity,unit_price_cents AS unit FROM order_items WHERE order_id=? ORDER BY id',[existing.id]);return {orderNumber:`LP-${existing.id}`,orderId:existing.id,totalCents:existing.total_cents,items};}
 const [pending]=await pool.query('SELECT payload_json,total_cents FROM pending_checkouts WHERE request_key=? AND stripe_payment_intent_id=?',[intent.metadata.request_key,intent.id]);
 if(!pending||Number(intent.amount_received)!==Number(pending.total_cents)) throw new Error('Payment could not be verified.');
 const receipt=await createOrder(JSON.parse(pending.payload_json),null,intent.id);
 await pool.query('DELETE FROM pending_checkouts WHERE request_key=?',[intent.metadata.request_key]);
 return receipt;
}
const server = http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('X-Frame-Options','DENY');
 const url = new URL(req.url,'http://localhost');
 try {
  if (requiresStaffAuthentication(url)) {
   if (!await isAdminRequest(req)) {res.setHeader('WWW-Authenticate','Basic realm="Luigi staff", charset="UTF-8"'); return send(res,401,{error:'Staff login required'});}
  }
  if (req.method==='GET' && url.pathname==='/api/session') {
   const objIdentity=await resolveIdentity(req);
   return send(res,200,{authenticated:Boolean(objIdentity),authReady:identityIsConfigured(),user:objIdentity});
  }
  if(req.method==='POST'&&url.pathname==='/api/stripe/webhook'){
   if(!process.env.STRIPE_WEBHOOK_SECRET)return send(res,503,{error:'Webhook is not configured.'});
   let strRaw;try{strRaw=await rawBody(req);}catch{return send(res,413,{error:'Webhook request is too large.'});}
   const arrSignature=(req.headers['stripe-signature']||'').split(',').map(strPart=>strPart.split('='));const strTimestamp=arrSignature.find(([strKey])=>strKey==='t')?.[1];const arrV1=arrSignature.filter(([strKey])=>strKey==='v1').map(([,strValue])=>strValue);
   const nTimestamp=Number(strTimestamp);if(!Number.isFinite(nTimestamp)||Math.abs(Date.now()/1000-nTimestamp)>300)return send(res,400,{error:'Invalid webhook signature.'});
   const strExpected=createHmac('sha256',process.env.STRIPE_WEBHOOK_SECRET).update(`${strTimestamp}.${strRaw}`).digest('hex');const bSignatureValid=arrV1.some(strValue=>{try{const supplied=Buffer.from(strValue,'hex'),expected=Buffer.from(strExpected,'hex');return supplied.length===expected.length&&timingSafeEqual(supplied,expected);}catch{return false;}});
   if(!bSignatureValid)return send(res,400,{error:'Invalid webhook signature.'});
   let event;try{event=JSON.parse(strRaw);}catch{return send(res,400,{error:'Invalid webhook payload.'});}
   if(event.type==='checkout.session.completed'&&event.data?.object?.payment_status==='paid'){try{await finishPaidCheckout(event.data.object);}catch{return send(res,500,{error:'Paid order is awaiting processing.'});}}
   if(event.type==='payment_intent.succeeded'){try{await finishPaidPaymentIntent(event.data.object);}catch{return send(res,500,{error:'Paid order is awaiting processing.'});}}
   return send(res,200,{received:true});
  }
  if(req.method==='GET'&&url.pathname==='/api/payment/config'){
   if(!process.env.STRIPE_PUBLISHABLE_KEY)return send(res,503,{error:'Online checkout is temporarily unavailable. Please try again later.'});
   return send(res,200,{publishableKey:process.env.STRIPE_PUBLISHABLE_KEY});
  }
  if(req.method==='POST'&&url.pathname==='/api/payment/intent'){
   if(!process.env.STRIPE_SECRET_KEY||!process.env.STRIPE_PUBLISHABLE_KEY)return send(res,503,{error:'Online checkout is temporarily unavailable. Please try again later.'});
   let payload;try{payload=await body(req);}catch{return send(res,400,{error:'Invalid checkout request.'});}
   const objIdentity=await resolveIdentity(req);if(objIdentity)payload={...payload,customer:{firstName:objIdentity.firstName,lastName:objIdentity.lastName,email:objIdentity.email,phone:objIdentity.phone}};
   const arrMenu=await pool.query('SELECT category,name,price_cents FROM menu_prices');
   let data;try{data=validateOrder(payload,new Map(arrMenu.map(r=>[`${r.category}:${r.name}`,r.price_cents])));}catch(error){return send(res,400,{error:error.message});}
   const conn=await pool.getConnection();try{await conn.query('INSERT INTO pending_checkouts(request_key,payload_json,total_cents) VALUES(?,?,?) ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json),total_cents=VALUES(total_cents)',[payload.requestKey,JSON.stringify(payload),data.total]);}finally{conn.release();}
   const [pending]=await pool.query('SELECT stripe_payment_intent_id FROM pending_checkouts WHERE request_key=?',[payload.requestKey]);
   if(pending?.stripe_payment_intent_id){
    let existing;try{existing=await stripeRequest(`payment_intents/${encodeURIComponent(pending.stripe_payment_intent_id)}`,null,'GET');}catch{}
    if(existing&&['requires_payment_method','requires_confirmation','requires_action'].includes(existing.status)){
     if(existing.amount===data.total)return send(res,200,{clientSecret:existing.client_secret});
     try{await stripeRequest(`payment_intents/${encodeURIComponent(existing.id)}/cancel`,new URLSearchParams(),'POST');}catch{return send(res,409,{error:'Your previous payment is still processing. Please wait a moment and try again.'});}
    }
   }
   const params=new URLSearchParams({amount:String(data.total),currency:'usd','receipt_email':data.customer.email,'metadata[request_key]':payload.requestKey,'automatic_payment_methods[enabled]':'true'});
   try{const intent=await stripeRequest('payment_intents',params);await pool.query('UPDATE pending_checkouts SET stripe_payment_intent_id=? WHERE request_key=?',[intent.id,payload.requestKey]);return send(res,200,{clientSecret:intent.client_secret});}catch{return send(res,503,{error:'Online checkout is temporarily unavailable. Please try again later.'});}
  }
  if(req.method==='POST'&&url.pathname==='/api/payment/confirm'){
   if(!process.env.STRIPE_SECRET_KEY)return send(res,503,{error:'Online checkout is temporarily unavailable.'});
   let bodyData;try{bodyData=await body(req);}catch{return send(res,400,{error:'Invalid payment confirmation.'});}
   if(!/^pi_[A-Za-z0-9]+$/.test(bodyData.paymentIntentId||''))return send(res,400,{error:'Invalid payment confirmation.'});
   try{return send(res,200,await finishPaidPaymentIntent(await stripeRequest(`payment_intents/${encodeURIComponent(bodyData.paymentIntentId)}`,null,'GET')));}catch{return send(res,402,{error:'Payment could not be verified. Please try again.'});}
  }
  if(req.method==='POST'&&url.pathname==='/api/checkout/session'){
   if(!process.env.STRIPE_SECRET_KEY||!process.env.SITE_URL)return send(res,503,{error:'Online checkout is temporarily unavailable. Please try again later.'});
   let payload;try{payload=await body(req);}catch{return send(res,400,{error:'Invalid checkout request.'});}
   const objIdentity=await resolveIdentity(req);if(objIdentity)payload={...payload,customer:{firstName:objIdentity.firstName,lastName:objIdentity.lastName,email:objIdentity.email,phone:objIdentity.phone}};
   const arrMenu=await pool.query('SELECT category,name,price_cents FROM menu_prices');
   let data;try{data=validateOrder(payload,new Map(arrMenu.map(r=>[`${r.category}:${r.name}`,r.price_cents])));}catch(error){return send(res,400,{error:error.message});}
   const conn=await pool.getConnection();try{await conn.query('INSERT INTO pending_checkouts(request_key,payload_json,total_cents) VALUES(?,?,?) ON DUPLICATE KEY UPDATE request_key=request_key',[payload.requestKey,JSON.stringify(payload),data.total]);}finally{conn.release();}
   const [pending]=await pool.query('SELECT stripe_session_id FROM pending_checkouts WHERE request_key=?',[payload.requestKey]);
   if(pending?.stripe_session_id){try{const existing=await stripeRequest(`checkout/sessions/${encodeURIComponent(pending.stripe_session_id)}`,null,'GET');if(existing.status==='open')return send(res,200,{url:existing.url});}catch{}}
   const params=new URLSearchParams({mode:'payment',success_url:`${process.env.SITE_URL}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,cancel_url:`${process.env.SITE_URL}/?checkout=cancelled`,customer_email:data.customer.email,client_reference_id:payload.requestKey,'metadata[request_key]':payload.requestKey});
   data.items.forEach((item,index)=>{params.set(`line_items[${index}][price_data][currency]`,'usd');params.set(`line_items[${index}][price_data][unit_amount]`,String(item.unit));params.set(`line_items[${index}][price_data][product_data][name]`,item.description);params.set(`line_items[${index}][quantity]`,String(item.quantity));});
   try{const session=await stripeRequest('checkout/sessions',params);await pool.query('UPDATE pending_checkouts SET stripe_session_id=? WHERE request_key=?',[session.id,payload.requestKey]);return send(res,200,{url:session.url});}catch{return send(res,503,{error:'Online checkout is temporarily unavailable. Please try again later.'});}
  }
  if(req.method==='GET'&&url.pathname==='/api/checkout/verify'){
   if(!process.env.STRIPE_SECRET_KEY)return send(res,503,{error:'Online checkout is temporarily unavailable.'});
   const sessionId=url.searchParams.get('session_id')||'';if(!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId))return send(res,400,{error:'Invalid checkout session.'});
   try{const session=await stripeRequest(`checkout/sessions/${encodeURIComponent(sessionId)}`,null,'GET');return send(res,200,await finishPaidCheckout(session));}catch{return send(res,402,{error:'Payment is not complete. Please finish checkout.'});}
  }
  if (req.method==='GET' && url.pathname==='/api/menu') {
   const rows = await pool.query('SELECT category,name,price_cents FROM menu_prices');
   return send(res,200,rows);
  }
  if (req.method==='POST' || req.method==='PATCH') {
   // Browser writes must originate on this host; no cross-origin API is enabled.
   const origin = req.headers.origin;
   let bSameOrigin=false;
   try {bSameOrigin=Boolean(origin) && new URL(origin).host===req.headers.host;} catch {}
   if (!bSameOrigin) return send(res,403,{error:'Invalid request origin'});
  }
  if (req.method==='POST' && url.pathname==='/api/orders') {
   return send(res,402,{error:'Online payment is required before an order can be placed.'});
  }
  if (req.method==='GET' && url.pathname==='/api/orders/mine') {
   const objIdentity=await resolveIdentity(req);
   if(!objIdentity) return send(res,401,{error:'Sign in to view your orders.'});
   const arrOrders=await pool.query('SELECT id,customer_name,customer_email,status,total_cents,created_at,updated_at FROM orders WHERE customer_email=? ORDER BY id DESC LIMIT 100',[objIdentity.email]);
   for(const objOrder of arrOrders){
    objOrder.items=await pool.query('SELECT kind,description,quantity,unit_price_cents FROM order_items WHERE order_id=? ORDER BY id',[objOrder.id]);
    objOrder.events=await pool.query("SELECT event_type,from_status,to_status,details,created_at FROM order_events WHERE order_id=? AND event_type IN ('created','status_changed') ORDER BY id",[objOrder.id]);
   }
   return send(res,200,arrOrders);
  }
  if (req.method==='GET' && url.pathname==='/api/admin/orders') {
   const strBucket=url.searchParams.get('bucket')==='past'?'past':'current';
   const strBucketWhere=strBucket==='past'?"status IN ('completed','cancelled')":"status IN ('received','preparing','ready')";
   const arrVisible = await pool.query(`SELECT id,customer_name,customer_email,customer_phone,status,total_cents,created_at,updated_at FROM orders WHERE ${strBucketWhere} ORDER BY id DESC LIMIT 500`);
   for (const objOrder of arrVisible) {
    objOrder.items = await pool.query('SELECT kind,description,quantity,unit_price_cents FROM order_items WHERE order_id=? ORDER BY id',[objOrder.id]);
    objOrder.needsAttention=orderAttention(objOrder);
   }
   return send(res,200,arrVisible);
  }
  if (req.method==='GET' && url.pathname==='/api/admin/analytics') {
   try {return send(res,200,buildSyntheticAnalytics(url.searchParams.get('view') || 'today'));}
   catch {return send(res,400,{error:'Choose a supported analytics view.'});}
  }
  if (req.method==='GET' && url.pathname==='/api/admin/analytics/products') {
   try {return send(res,200,buildSyntheticItemComparison(url.searchParams.get('left')||'pizza:Small',url.searchParams.get('right')||'drink:Dr Pepper (Medium)',url.searchParams.get('period')||'week'));}
   catch {return send(res,400,{error:'Choose valid products and a supported period.'});}
  }
  if (req.method==='GET' && url.pathname==='/api/admin/analytics/employees') return send(res,200,buildSyntheticEmployeeData());
  if (req.method==='GET' && url.pathname==='/api/admin/analytics/business') return send(res,200,buildSyntheticBusinessData());
  const mapBrowserModules={'/admin-model.js':'./admin-model.js','/admin-demo.js':'./admin-demo.js','/domain.js':'./domain.js','/validation.js':'./validation.js'};
  if (req.method==='GET' && mapBrowserModules[url.pathname]) {
   const strSource=await readFile(new URL(mapBrowserModules[url.pathname],import.meta.url));
   res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});return res.end(strSource);
  }
  if (req.method==='GET' && url.pathname==='/api/admin/customers') {
   const q=(url.searchParams.get('q') || '').slice(0,100);
   return send(res,200,await pool.query('SELECT c.id,c.first_name,c.last_name,c.email,c.phone,COUNT(o.id) AS order_count,COALESCE(SUM(CASE WHEN o.status <> \'cancelled\' THEN o.total_cents ELSE 0 END),0) AS total_cents,MAX(o.created_at) AS last_order FROM customers c LEFT JOIN orders o ON o.customer_id=c.id WHERE c.email LIKE ? OR c.last_name LIKE ? GROUP BY c.id ORDER BY c.updated_at DESC LIMIT 100',[`%${q}%`,`%${q}%`]));
  }
  const match=url.pathname.match(/^\/api\/admin\/orders\/(\d+)$/);
  if (req.method==='PATCH' && match) {
   let status;
   try {({status}=await body(req));} catch {return send(res,400,{error:'Invalid JSON'});}
   if (!Object.hasOwn(allowedTransitions,status)) return send(res,400,{error:'Invalid status'});
   const from=Object.keys(allowedTransitions).filter(s=>allowedTransitions[s].includes(status));
   if (!from.length) return send(res,409,{error:'Invalid status transition'});
   const conn=await pool.getConnection();
   try {
    await conn.beginTransaction();
    const [objOrder]=await conn.query('SELECT status FROM orders WHERE id=? FOR UPDATE',[match[1]]);
    if(!objOrder){await conn.rollback();return send(res,404,{error:'Order not found.'});}
    if(!canTransitionStatus(objOrder.status,status)){await conn.rollback();return send(res,409,{error:'Order changed or transition is not allowed. Refresh the queue.'});}
    await conn.query('UPDATE orders SET status=? WHERE id=?',[status,match[1]]);
    await conn.query("INSERT INTO order_events(order_id,actor_email,event_type,from_status,to_status,details) VALUES(?,?,'status_changed',?,?,?)",[match[1],(await resolveIdentity(req))?.email || 'staff',objOrder.status,status,`Status changed to ${status}`]);
    await conn.commit();
    return send(res,200,{status});
   }catch(error){await conn.rollback();throw error;}finally{conn.release();}
  }
  const editMatch=url.pathname.match(/^\/api\/admin\/orders\/(\d+)\/items$/);
  if(req.method==='PATCH' && editMatch){
   let payload;
   try{payload=await body(req);}catch{return send(res,400,{error:'Invalid JSON'});}
   const conn=await pool.getConnection();
   try{
    await conn.beginTransaction();
    const [objOrder]=await conn.query('SELECT status FROM orders WHERE id=? FOR UPDATE',[editMatch[1]]);
    if(!objOrder){await conn.rollback();return send(res,404,{error:'Order not found.'});}
    if(!['received','preparing','ready'].includes(objOrder.status)){await conn.rollback();return send(res,409,{error:'Only active orders can be edited.'});}
    const arrMenu=await conn.query('SELECT category,name,price_cents FROM menu_prices');
    let arrItems;
    try{arrItems=normalizeEditableItems(payload.items,new Map(arrMenu.map(objRow=>[`${objRow.category}:${objRow.name}`,objRow.price_cents])));}catch(error){await conn.rollback();return send(res,400,{error:error.message});}
    if(!arrItems.length || arrItems.length>40){await conn.rollback();return send(res,400,{error:'An edited order must contain 1 to 40 valid items.'});}
    const nTotal=arrItems.reduce((nSum,objItem)=>nSum+objItem.quantity*objItem.unit,0);
    if(!Number.isSafeInteger(nTotal)||nTotal>4294967295){await conn.rollback();return send(res,400,{error:'Edited order total is too large.'});}
    await conn.query('DELETE FROM order_items WHERE order_id=?',[editMatch[1]]);
    for(const objItem of arrItems) await conn.query('INSERT INTO order_items(order_id,kind,description,quantity,unit_price_cents) VALUES(?,?,?,?,?)',[editMatch[1],objItem.kind,objItem.description,objItem.quantity,objItem.unit]);
    await conn.query('UPDATE orders SET total_cents=? WHERE id=?',[nTotal,editMatch[1]]);
    await conn.query("INSERT INTO order_events(order_id,actor_email,event_type,from_status,to_status,details) VALUES(?,?,'items_edited',?,?,?)",[editMatch[1],(await resolveIdentity(req))?.email || 'staff',objOrder.status,objOrder.status,`Order items and total updated to ${nTotal} cents`]);
    await conn.commit();
    return send(res,200,{items:arrItems,totalCents:nTotal});
   }catch(error){await conn.rollback();throw error;}finally{conn.release();}
  }
  const pages={'/':'index.html','/admin':'admin.html','/admin/analytics':'admin.html'};
  if (req.method==='GET' && pages[url.pathname]) {
   const html=await readFile(new URL(url.pathname==='/'?'../index.html':`./public/${pages[url.pathname]}`,import.meta.url));
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}); return res.end(html);
  }
  send(res,404,{error:'Not found'});
 } catch(error) {console.error('Request failed:',error.code || error.name); send(res,503,{error:'Ordering service is temporarily unavailable. Please retry.'});}
});
server.requestTimeout=15000;
server.headersTimeout=10000;
server.listen(Number(process.env.PORT || 3000),process.env.HOST || '127.0.0.1',()=>console.log('Luigi ordering service started'));
process.on('SIGTERM',()=>server.close(async()=>{await pool.end();process.exit(0);}));
