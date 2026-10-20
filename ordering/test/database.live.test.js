import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
test('live MariaDB: schema, menu, foreign keys, insert and rollback',{skip:process.env.RUN_DB_TEST!=='1'},async()=>{
 const {default:objDriver}=await import('mariadb');
 const objConnection=await objDriver.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'luigis',bigIntAsNumber:true});
 try {
  const arrTables=await objConnection.query("SELECT TABLE_NAME AS name,ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
  for(const strName of ['customers','orders','order_items','order_events','menu_prices'])assert.ok(arrTables.some(objRow=>objRow.name===strName&&objRow.engine==='InnoDB'),strName+' must exist with InnoDB');
  const arrMenu=await objConnection.query('SELECT category,name,price_cents FROM menu_prices');assert.equal(arrMenu.length,18);
  const arrKeys=await objConnection.query("SELECT CONSTRAINT_NAME AS name FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()");assert.ok(arrKeys.some(objRow=>objRow.name==='order_customer'));assert.ok(arrKeys.some(objRow=>objRow.name==='item_order'));
  await objConnection.beginTransaction();
  const strEmail=`db-test-${randomUUID()}@example.invalid`;
  const objCustomer=await objConnection.query('INSERT INTO customers(first_name,last_name,email,phone) VALUES(?,?,?,?)',['Database','Verification',strEmail,'']);
  const objOrder=await objConnection.query('INSERT INTO orders(request_key,customer_id,customer_name,customer_email,customer_phone,total_cents) VALUES(?,?,?,?,?,?)',[randomUUID(),objCustomer.insertId,'Database Verification',strEmail,'',1000]);
  await objConnection.query('INSERT INTO order_items(order_id,kind,description,quantity,unit_price_cents) VALUES(?,?,?,?,?)',[objOrder.insertId,'pizza','Small pizza',1,1000]);
  await objConnection.query("INSERT INTO order_events(order_id,actor_email,event_type,to_status,details) VALUES(?,?,'created','received','Test order')",[objOrder.insertId,strEmail]);
  const arrItems=await objConnection.query('SELECT description FROM order_items WHERE order_id=?',[objOrder.insertId]);assert.equal(arrItems.length,1);
  await objConnection.rollback();
  const arrRemaining=await objConnection.query('SELECT id FROM customers WHERE email=?',[strEmail]);assert.equal(arrRemaining.length,0);
 } finally {await objConnection.rollback();await objConnection.end();}
});
