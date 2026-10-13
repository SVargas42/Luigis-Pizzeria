import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import mariadb from 'mariadb';
import {validateOrder} from './validation.js';

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
async function body(req) {
 if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new Error('JSON required');
 let raw='';
 for await (const chunk of req) {raw += chunk; if (Buffer.byteLength(raw)>32768) throw new Error('Request too large');}
 return JSON.parse(raw);
}
async function createOrder(payload) {
 const conn = await pool.getConnection();
 try {
  await conn.beginTransaction();
  const rows = await conn.query('SELECT category,name,price_cents FROM menu_prices');
  const data = validateOrder(payload,new Map(rows.map(r=>[`${r.category}:${r.name}`,r.price_cents])));
  // Claim the retry key before changing any customer data. Duplicate inserts wait
  // for the original transaction and then return its committed receipt.
  await conn.query('INSERT INTO customers(first_name,last_name,email,phone) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)',[data.customer.firstName,data.customer.lastName,data.customer.email,data.customer.phone]);
  const [customer] = await conn.query('SELECT id FROM customers WHERE email=?',[data.customer.email]);
  const result = await conn.query('INSERT INTO orders(request_key,customer_id,customer_name,customer_email,customer_phone,total_cents) VALUES(?,?,?,?,?,?)',[payload.requestKey,customer.id,`${data.customer.firstName} ${data.customer.lastName}`,data.customer.email,data.customer.phone,data.total]);
  await conn.query('UPDATE customers SET first_name=?,last_name=?,phone=? WHERE id=?',[data.customer.firstName,data.customer.lastName,data.customer.phone,customer.id]);
  for (const item of data.items) await conn.query('INSERT INTO order_items(order_id,kind,description,quantity,unit_price_cents) VALUES(?,?,?,?,?)',[result.insertId,item.kind,item.description,item.quantity,item.unit]);
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
  if (url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/admin')) {
   if (!authorized(req)) {res.setHeader('WWW-Authenticate','Basic realm="Luigi staff", charset="UTF-8"'); return send(res,401,{error:'Staff login required'});}
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
   try {return send(res,201,await createOrder(payload));}
   catch (error) { if (error.message.startsWith('Please check')) return send(res,400,{error:error.message}); throw error; }
  }
  if (req.method==='GET' && url.pathname==='/api/admin/orders') {
   const orders = await pool.query('SELECT id,customer_name,customer_email,customer_phone,status,total_cents,created_at FROM orders ORDER BY id DESC LIMIT 100');
   for (const order of orders) order.items = await pool.query('SELECT description,quantity FROM order_items WHERE order_id=? ORDER BY id',[order.id]);
   return send(res,200,orders);
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
   const result=await pool.query(`UPDATE orders SET status=? WHERE id=? AND status IN (${from.map(()=>'?').join(',')})`,[status,match[1],...from]);
   return send(res,result.affectedRows?200:409,result.affectedRows?{status}:{error:'Order changed or transition is not allowed. Refresh the queue.'});
  }
  const pages={'/':'index.html','/admin':'admin.html'};
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
