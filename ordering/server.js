import http from 'node:http';
import {readFile} from 'node:fs/promises';
import mariadb from 'mariadb';
import Stripe from 'stripe';
import {createPaymentService} from './payments.js';
import {normalizeEditableItems,validateOrder} from './validation.js';
import {canTransitionStatus,orderAttention} from './domain.js';
import {identityIsConfigured,resolveIdentity} from './identity.js';
import {createAccountService,deliverAccountMail} from './accounts.js';
import {mailConfigFromEnvironment} from './mail.js';
import {setIdentityResolver} from './identity.js';
import {loadAnalytics} from './analytics.js';
import {requiresStaffAuthentication,canAccessStaffRoute} from './admin-access.js';
import {createMenuProxy} from './menu-proxy.js';

for (const key of ['DB_PASSWORD','SITE_URL']) {
 if (!process.env[key] || /replace-|PUT_YOUR|CHOOSE_A|YOUR_/i.test(process.env[key])) throw new Error(`Set ${key} in .env before starting.`);
}
const pool = mariadb.createPool({host:process.env.DB_HOST || '127.0.0.1',port:Number(process.env.DB_PORT || 3306),user:process.env.DB_USER || 'luigis_app',password:process.env.DB_PASSWORD,database:process.env.DB_NAME || 'luigis',connectionLimit:10,bigIntAsNumber:true,timezone:'Z',initSql:"SET time_zone = '+00:00'"});
const objAccountConfig={siteUrl:process.env.SITE_URL,...mailConfigFromEnvironment(process.env),trustLoopbackProxy:process.env.TRUST_PROXY_LOOPBACK==='1'};
const objAccounts=createAccountService(pool,objAccountConfig);
setIdentityResolver(objRequest=>objAccounts.identity(objRequest));
let bMailWorkerBusy=false;
const objMailTimer=setInterval(async()=>{if(bMailWorkerBusy)return;bMailWorkerBusy=true;try{await deliverAccountMail(pool,objAccountConfig);}catch(objError){console.error('Account mail worker failed:',objError.code||objError.name);}finally{bMailWorkerBusy=false;}},5000);objMailTimer.unref();
const bStripeEnabled=process.env.STRIPE_ENABLED==='1';
const bStripeConfigured=['test','live'].includes(process.env.STRIPE_MODE)&&process.env.STRIPE_SECRET_KEY?.startsWith('sk_'+process.env.STRIPE_MODE+'_')&&process.env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_');
if(bStripeEnabled&&!bStripeConfigured)throw Error('Configure matching STRIPE_MODE, STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.');
const objStripeConfig={enabled:bStripeEnabled,liveMode:process.env.STRIPE_MODE==='live',webhookSecret:process.env.STRIPE_WEBHOOK_SECRET,siteUrl:process.env.SITE_URL,taxBasisPoints:Number(process.env.TAX_BASIS_POINTS||0)};
const objStripe=bStripeConfigured?new Stripe(process.env.STRIPE_SECRET_KEY,{maxNetworkRetries:2,timeout:10000}):null;
const objPayments=createPaymentService(pool,objStripe,objStripeConfig);
const forwardMenuRequest=createMenuProxy({resolveIdentity,readBody:body,lifecycleUrl:process.env.LIFECYCLE_URL,siteUrl:process.env.SITE_URL,staffUser:process.env.ADMIN_USER,staffPassword:process.env.ADMIN_PASSWORD});
const allowedTransitions = {received:['preparing','cancelled'],preparing:['ready','cancelled'],ready:['completed','cancelled'],completed:[],cancelled:[]};
function send(res,status,data) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(JSON.stringify(data)); }

async function isAdminRequest(req) {
 const objIdentity=await resolveIdentity(req);
 return objIdentity?.role==='admin';
}
async function isAllowedStaffRequest(req,objUrl){return canAccessStaffRoute((await resolveIdentity(req))?.role,objUrl,req.method);}
async function body(req) {
 if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new Error('JSON required');
 return JSON.parse(await rawBody(req,32768));
}
async function rawBody(req,nLimit=65536,bBuffer=false) {
 const arrChunks=[];let nBytes=0;
 for await(const bufChunk of req){nBytes+=bufChunk.length;if(nBytes>nLimit)throw new Error('Request too large');arrChunks.push(bufChunk);}
 return bBuffer?Buffer.concat(arrChunks):Buffer.concat(arrChunks).toString('utf8');
}
const server = http.createServer(async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('X-Frame-Options','DENY');
 let url;try{url=new URL(req.url,'http://localhost');}catch{return send(res,400,{error:'Invalid URL'});}
 try {
  if(['POST','PATCH','PUT','DELETE'].includes(req.method)&&url.pathname!=='/api/stripe/webhook'){
   if(req.headers.origin!==new URL(process.env.SITE_URL).origin)return send(res,403,{error:'Invalid request origin'});
  }
  if(req.method==='POST'&&(url.pathname.startsWith('/api/auth/')||['/api/admin/accounts/invite','/api/admin/accounts/update'].includes(url.pathname))){
   let objInput;try{objInput=await body(req);if(!objInput||Array.isArray(objInput)||typeof objInput!=='object')throw Error();}catch{return send(res,400,{error:'Send a JSON object (maximum 32 KB).'});}
   try{const objResult=await objAccounts.handle(req,url.pathname,objInput);if(objResult.cookie)res.setHeader('Set-Cookie',objResult.cookie);return send(res,objResult.status,objResult.data);}catch(objError){return send(res,objError.status||(objError.code==='ER_DUP_ENTRY'?409:503),{error:objError.status?objError.message:objError.code==='ER_DUP_ENTRY'?'This account already exists.':'Account service is temporarily unavailable.'});}
  }
  if (requiresStaffAuthentication(url)) {
   if (!await isAllowedStaffRequest(req,url)) {if(!url.pathname.startsWith('/api/')){res.writeHead(303,{Location:'/account?mode=login&next='+encodeURIComponent(url.pathname)});return res.end();}return send(res,403,{error:'This account does not have permission for this staff action.'});}
  }
  const objMenuResponse=await forwardMenuRequest(req,url);
  if(objMenuResponse)return send(res,objMenuResponse.status,objMenuResponse.data);
  if(req.method==='GET'&&url.pathname==='/api/admin/accounts')return send(res,200,await objAccounts.listAccounts());
  if (req.method==='GET' && url.pathname==='/api/session') {
   const objIdentity=await resolveIdentity(req);
   return send(res,200,{authenticated:Boolean(objIdentity),authReady:identityIsConfigured(),user:objIdentity});
  }
  if(req.method==='POST'&&url.pathname==='/api/stripe/webhook'){
   try{return send(res,200,await objPayments.webhook(await rawBody(req,262144,true),req.headers['stripe-signature']));}catch(objError){console.error('Stripe webhook failed:',objError.code||objError.status||objError.name);return send(res,objError.status||503,{error:objError.status===400?'Invalid webhook signature or environment.':'Payment processing will be retried.'});}
  }
  if(req.method==='GET'&&url.pathname==='/api/stripe/config')return send(res,200,{enabled:bStripeEnabled});
  if(req.method==='POST'&&['/api/stripe/checkout','/api/stripe/status'].includes(url.pathname)){
   let objInput;try{objInput=await body(req);if(!objInput||typeof objInput!=='object'||Array.isArray(objInput))throw Error();}catch{return send(res,400,{error:'Invalid checkout request.'});}
   try{
    const objIdentity=await resolveIdentity(req);
    if(url.pathname.endsWith('/checkout')){if(!bStripeEnabled)return send(res,503,{error:'Online checkout is unavailable. Please choose payment at pickup.'});await objAccounts.limitCheckout(req,objIdentity?.email||objInput.customer?.email||'');await objAccounts.claimOrder(objInput.requestKey,objIdentity);return send(res,200,await objPayments.createCheckout(objInput,objIdentity));}
    return send(res,200,await objPayments.checkoutStatus(objInput,objIdentity));
   }catch(objError){console.error('Stripe request failed:',objError.code||objError.status||objError.name);return send(res,objError.status||503,{error:objError.status?objError.message:'Payment service unavailable. Retry this checkout; do not submit a second payment.'});}
  }
  if(url.pathname.startsWith('/api/payment/')||url.pathname.startsWith('/api/checkout/'))return send(res,410,{error:'Use the Stripe-hosted checkout endpoint.'});
  if (req.method==='GET' && url.pathname==='/api/menu') {
   const rows = await pool.query('SELECT category,name,description,price_cents FROM menu_prices WHERE is_active = 1');
   return send(res,200,rows);
  }
  if (req.method==='POST' || req.method==='PATCH') {
   // Browser writes must originate on this host; no cross-origin API is enabled.
   const origin = req.headers.origin;
   let bSameOrigin=false;
   try {bSameOrigin=Boolean(origin) && new URL(origin).host===req.headers.host;} catch {}
   if (!bSameOrigin) return send(res,403,{error:'Invalid request origin'});
  }
  const bLifecycleRoute=(req.method==='POST'&&url.pathname==='/api/orders') || /^\/api\/orders\/[0-9a-f]+\/track$/.test(url.pathname) || url.pathname.startsWith('/api/employee/orders/');
  if(bLifecycleRoute){
   if(url.pathname.startsWith('/api/employee/')&&!await isAllowedStaffRequest(req,url)){
    return send(res,403,{error:'Administrator account required'});
   }
   let objSubmit=['POST','PATCH'].includes(req.method)?await body(req):undefined;
   const objActor=await resolveIdentity(req);
   if(req.method==='POST'&&url.pathname==='/api/orders'){
    if(objSubmit.paymentMethod!=='in_store')return send(res,400,{error:'Use Stripe checkout for online payments.'});
    try{await objPayments.reserveCheckoutKey(objSubmit.requestKey,'pickup',objActor);}catch(objError){return send(res,objError.status||503,{error:objError.status?objError.message:'Checkout reservation unavailable.'});}
    if(objActor)objSubmit.customer={firstName:objActor.firstName,lastName:objActor.lastName,email:objActor.email,phone:objActor.phone};
    try{await objAccounts.claimOrder(objSubmit.requestKey,objActor);}catch(objError){return send(res,objError.status||503,{error:objError.status?objError.message:'Order ownership check failed.'});}
   }
   const strPayload=objSubmit?JSON.stringify(objSubmit):undefined;
   // Only the local lifecycle service receives staff credentials; never forward a client-controlled host.
   const objResponse=await fetch(new URL(url.pathname,process.env.LIFECYCLE_URL||'http://127.0.0.1:8000'),{
    method:req.method,headers:{'Content-Type':'application/json',...(url.pathname.startsWith('/api/employee/')?{'X-Luigi-Actor':objActor.email,Authorization:'Basic '+Buffer.from(`${process.env.ADMIN_USER}:${process.env.ADMIN_PASSWORD}`).toString('base64')}:{})},
    body:strPayload,signal:AbortSignal.timeout(12000)
   });
   const objResult=await objResponse.json();
   if(url.pathname==='/api/employee/orders/active'&&objResponse.ok&&Array.isArray(objResult)){
    const arrPaymentRows=await pool.query("SELECT id,payment_status,refunded_cents FROM orders WHERE status NOT IN ('completed','cancelled')");
    const mapPayments=new Map(arrPaymentRows.map(objRow=>[String(objRow.id),objRow]));for(const objOrder of objResult){const objPayment=mapPayments.get(String(objOrder.id));if(objPayment){objOrder.payment_status=objPayment.payment_status;objOrder.refunded_cents=objPayment.refunded_cents;}}
   }
   return send(res,objResponse.status,objResult);
  }
  if (req.method==='GET' && url.pathname==='/api/orders/mine') {
   const objIdentity=await resolveIdentity(req);
   if(!objIdentity) return send(res,401,{error:'Sign in to view your orders.'});
   const arrOrders=await pool.query('SELECT o.id,o.customer_name,o.customer_email,o.status,o.total_cents,o.created_at,o.updated_at,o.tracking_status,o.estimated_pickup_time,o.payment_method,o.payment_status,o.refunded_cents FROM orders o JOIN account_order_claims a ON a.request_key=o.request_key WHERE a.account_id=? ORDER BY o.id DESC LIMIT 100',[objIdentity.id]);
   for(const objOrder of arrOrders){
    objOrder.items=await pool.query('SELECT kind,description,quantity,unit_price_cents FROM order_items WHERE order_id=? ORDER BY id',[objOrder.id]);
    objOrder.events=await pool.query("SELECT event_type,from_status,to_status,details,created_at FROM order_events WHERE order_id=? AND event_type IN ('created','status_changed') ORDER BY id",[objOrder.id]);
   }
   return send(res,200,arrOrders);
  }
  if (req.method==='GET' && url.pathname==='/api/admin/orders') {
   const strBucket=url.searchParams.get('bucket')==='past'?'past':'current';
   const strBucketWhere=strBucket==='past'?"status IN ('completed','cancelled')":"status IN ('received','preparing','ready')";
   const arrVisible = await pool.query(`SELECT id,customer_name,customer_email,customer_phone,status,total_cents,created_at,updated_at,payment_method,payment_status,refunded_cents,stripe_payment_intent_id FROM orders WHERE ${strBucketWhere} ORDER BY id DESC LIMIT 500`);
   for (const objOrder of arrVisible) {
    objOrder.items = await pool.query('SELECT kind,description,quantity,unit_price_cents FROM order_items WHERE order_id=? ORDER BY id',[objOrder.id]);
    objOrder.needsAttention=orderAttention(objOrder);
   }
   return send(res,200,arrVisible);
  }
  if (req.method==='GET' && url.pathname==='/api/admin/analytics') {
   try {return send(res,200,(await loadAnalytics(pool)).ordering(url.searchParams.get('view') || 'today'));}
   catch {return send(res,400,{error:'Choose a supported analytics view.'});}
  }
  if (req.method==='GET' && url.pathname==='/api/admin/analytics/products') {
   try {return send(res,200,(await loadAnalytics(pool)).products(url.searchParams.get('left')||'pizza:Small',url.searchParams.get('right')||'drink:Dr Pepper (Medium)',url.searchParams.get('period')||'week'));}
   catch {return send(res,400,{error:'Choose valid products and a supported period.'});}
  }
  if (req.method==='GET' && url.pathname==='/api/admin/analytics/employees') return send(res,200,(await loadAnalytics(pool)).employees);
  if (req.method==='GET' && url.pathname==='/api/admin/analytics/business') return send(res,200,(await loadAnalytics(pool)).business);
  const mapBrowserModules={'/staff.js':'./public/staff.js','/admin-model.js':'./admin-model.js','/admin-demo.js':'./admin-demo.js','/domain.js':'./domain.js','/validation.js':'./validation.js','/tracker.js':'./public/tracker.js','/account.js':'./public/account.js','/stripe-checkout.js':'./public/stripe-checkout.js'};
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
    const [objOrder]=await conn.query('SELECT status,tracking_status FROM orders WHERE id=? FOR UPDATE',[match[1]]);
    if(!objOrder){await conn.rollback();return send(res,404,{error:'Order not found.'});}
    if(objOrder.tracking_status){await conn.rollback();return send(res,409,{error:'Use the lifecycle controls for this order.'});}
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
    const [objOrder]=await conn.query('SELECT status,tracking_status,payment_method FROM orders WHERE id=? FOR UPDATE',[editMatch[1]]);
    if(!objOrder){await conn.rollback();return send(res,404,{error:'Order not found.'});}
    if(objOrder.tracking_status||['online','card'].includes(objOrder.payment_method)){await conn.rollback();return send(res,409,{error:'Paid or lifecycle receipts cannot be edited. Refund and create a new order if needed.'});}
    if(!['received','preparing','ready'].includes(objOrder.status)){await conn.rollback();return send(res,409,{error:'Only active orders can be edited.'});}
    const arrMenu=await conn.query('SELECT category,name,price_cents FROM menu_prices WHERE is_active = 1');
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
  const pages={'/staff':'staff.html','/account':'account.html','/admin/accounts':'account.html','/track':'tracker.html','/':'index.html','/admin':'admin.html','/admin/analytics':'admin.html'};
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
