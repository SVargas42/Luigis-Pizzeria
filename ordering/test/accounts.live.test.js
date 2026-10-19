import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createAccountService,digestToken,hashPassword} from '../accounts.js';
test('live MariaDB account schema, sessions, revocation and ownership joins',{skip:process.env.RUN_DB_TEST!=='1'},async()=>{
 const {default:objDriver}=await import('mariadb');
 const objConnection=await objDriver.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'luigis',bigIntAsNumber:true,timezone:'Z'});
 try{
  await objConnection.beginTransaction();
  for(const strTable of ['accounts','account_sessions','account_actions','account_order_claims','account_mail','account_throttles','account_audit']){const arrRows=await objConnection.query(`SELECT * FROM ${strTable} LIMIT 0`);assert.ok(Array.isArray(arrRows));}
  const strEmail=`account-test-${randomUUID()}@example.invalid`,strPasswordHash=await hashPassword('a long testing passphrase');
  const objAccount=await objConnection.query("INSERT INTO accounts(email,first_name,last_name,phone,password_hash,role,email_verified_at) VALUES(?,'Database','Test','5551234567',?,'customer',UTC_TIMESTAMP())",[strEmail,strPasswordHash]);
  const strToken=randomBytes(32).toString('hex');await objConnection.query('INSERT INTO account_sessions(token_hash,account_id,expires_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[digestToken(strToken),objAccount.insertId]);
  const objService=createAccountService({query:objConnection.query.bind(objConnection)},{siteUrl:'http://127.0.0.1:3000'}),objRequest={headers:{cookie:'luigi_session='+strToken}};
  assert.equal((await objService.identity(objRequest)).email,strEmail);
  const strKey=randomUUID();await objConnection.query('INSERT INTO account_order_claims(request_key,account_id) VALUES(?,?)',[strKey,objAccount.insertId]);
  const objCustomer=await objConnection.query("INSERT INTO customers(first_name,last_name,email,phone) VALUES('Database','Test',?,'5551234567')",[strEmail]);
  const objOrder=await objConnection.query("INSERT INTO orders(request_key,customer_id,customer_name,customer_email,customer_phone,total_cents) VALUES(?,?,'Database Test',?,'5551234567',1000)",[strKey,objCustomer.insertId,strEmail]);
  const arrOwned=await objConnection.query('SELECT o.id FROM orders o JOIN account_order_claims a ON a.request_key=o.request_key WHERE a.account_id=?',[objAccount.insertId]);assert.ok(arrOwned.some(objRow=>objRow.id===Number(objOrder.insertId)));
  await objConnection.query('UPDATE accounts SET disabled_at=UTC_TIMESTAMP() WHERE id=?',[objAccount.insertId]);assert.equal(await objService.identity(objRequest),null);
  await objConnection.rollback();const arrLeft=await objConnection.query('SELECT id FROM accounts WHERE email=?',[strEmail]);assert.equal(arrLeft.length,0);
 }finally{await objConnection.rollback();await objConnection.end();}
});
