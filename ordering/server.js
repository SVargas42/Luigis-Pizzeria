import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
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
async function createOrder(payload,objIdentity=null) {
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
  const result = await conn.query('INSERT INTO orders(request_key,customer_id,customer_name,customer_email,customer_phone,total_cents) VALUES(?,?,?,?,?,?)',[payload.requestKey,customer.id,`${data.customer.firstName} ${data.customer.lastName}`,data.customer.email,data.customer.phone,data.total]);
  await conn.query('UPDATE customers SET first_name=?,last_name=?,phone=? WHERE id=?',[data.customer.firstName,data.customer.lastName,data.customer.phone,customer.id]);
  for (const item of data.items) await conn.query('INSERT INTO order_items(order_id,kind,description,quantity,unit_price_cents) VALUES(?,?,?,?,?)',[result.insertId,item.kind,item.description,item.quantity,item.unit]);
  await conn.query("INSERT INTO order_events(order_id,actor_email,event_type,to_status,details) VALUES(?,?,'created','received','Order placed')",[result.insertId,objIdentity?.email || data.customer.email]);
  await conn.commit();
  return {orderNumber:`LP-${result.insertId}`,totalCents:data.total,items:data.items};
 } catch (error) {
  await conn.rollback();
  if (error.code === 'ER_DUP_ENTRY') {
   const [order] = await conn.query('SELECT id,total_cents FROM orders WHERE request_key=?',[payload.requestKey]);
   if (order) {
    const items = await conn.query('SELECT kind,description,quantity,unit_price_cents AS unit FROM order_items WHERE order_id=? ORDER BY id',[order.id]);
    return {orderNumber:`LP-${order.id}`,totalCents:order.total_cents,items};
   }
  }
  throw error;
 } finally {conn.release();}
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
   let payload;
   try {payload=await body(req);} catch {return send(res,400,{error:'Invalid JSON request (maximum 32 KB)'});}
   try {return send(res,201,await createOrder(payload,await resolveIdentity(req)));}
   catch (error) { if (error.message.startsWith('Please check')) return send(res,400,{error:error.message}); throw error; }
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
