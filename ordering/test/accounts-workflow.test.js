import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAccountService,hashPassword,digestToken,deliverAccountMail} from '../accounts.js';
function createStore(){
 let objState={accounts:[],sessions:[],actions:[],mail:[],audit:[],throttles:new Map()};
 const now=()=>new Date().toISOString();
 async function query(strSql,arrValues=[]){
  if(strSql.startsWith('INSERT INTO account_throttles')){objState.throttles.set(arrValues[0],(objState.throttles.get(arrValues[0])||0)+1);return {};}
  if(strSql.startsWith('SELECT attempts'))return [{attempts:objState.throttles.get(arrValues[0])}];
  if(strSql.startsWith('INSERT INTO accounts')){if(objState.accounts.some(objRow=>objRow.email===arrValues[0]))throw Object.assign(Error(),{code:'ER_DUP_ENTRY'});const objAccount={id:objState.accounts.length+1,email:arrValues[0],first_name:arrValues[1],last_name:arrValues[2],phone:arrValues[3],password_hash:strSql.includes("'customer'")?arrValues[4]:null,role:strSql.includes("'customer'")?'customer':arrValues[4],email_verified_at:null,disabled_at:null};objState.accounts.push(objAccount);return {insertId:objAccount.id};}
  if(strSql.startsWith('SELECT * FROM accounts WHERE email'))return objState.accounts.filter(objRow=>objRow.email===arrValues[0]&&(!strSql.includes('disabled_at IS NULL')||!objRow.disabled_at)).map(objRow=>({...objRow}));
  if(strSql.startsWith('SELECT password_hash')||strSql.startsWith('SELECT disabled_at')||strSql.startsWith('SELECT role,disabled_at'))return objState.accounts.filter(objRow=>String(objRow.id)===String(arrValues[0])).map(objRow=>({...objRow}));
  if(strSql.startsWith("SELECT id FROM accounts WHERE role='admin'"))return objState.accounts.filter(objRow=>objRow.role==='admin'&&!objRow.disabled_at).map(objRow=>({id:objRow.id}));
  if(strSql.startsWith('SELECT a.* FROM account_sessions')){const objSession=objState.sessions.find(objRow=>objRow.token_hash===arrValues[0]);return objSession?objState.accounts.filter(objRow=>objRow.id===objSession.account_id&&!objRow.disabled_at&&objRow.email_verified_at).map(objRow=>({...objRow})):[];}
  if(strSql.startsWith('INSERT INTO account_sessions')){objState.sessions.push({token_hash:arrValues[0],account_id:Number(arrValues[1])});return {};}
  if(strSql.startsWith('DELETE FROM account_sessions')){objState.sessions=objState.sessions.filter(objRow=>strSql.includes('token_hash')?objRow.token_hash!==arrValues[0]:String(objRow.account_id)!==String(arrValues[0]));return {};}
  if(strSql.startsWith('DELETE FROM account_actions')){objState.actions=objState.actions.filter(objRow=>String(objRow.account_id)!==String(arrValues[0])||(arrValues[1]&&objRow.purpose!==arrValues[1]));return {};}
  if(strSql.startsWith('INSERT INTO account_actions')){objState.actions.push({token_hash:arrValues[0],account_id:arrValues[1],purpose:arrValues[2]});return {};}
  if(strSql.startsWith('SELECT * FROM account_actions'))return objState.actions.filter(objRow=>objRow.token_hash===arrValues[0]&&objRow.purpose===arrValues[1]);
  if(strSql.startsWith('INSERT INTO account_mail')){objState.mail.push({id:arrValues[0],recipient:arrValues[1],subject:arrValues[2],message:arrValues[3],attempts:0});return {};}
  if(strSql.startsWith('SELECT * FROM account_mail'))return objState.mail.filter(objRow=>!objRow.sent_at&&objRow.attempts<10).slice(0,1);
  if(strSql.startsWith('UPDATE account_mail')){const objMail=objState.mail.find(objRow=>objRow.id===arrValues[0]);objMail.attempts++;if(strSql.includes('sent_at=')){objMail.sent_at=now();objMail.message='';}return {};}
  if(strSql.startsWith('INSERT INTO account_audit')){objState.audit.push(arrValues);return {};}
  if(strSql.startsWith('UPDATE accounts SET email_verified_at')){objState.accounts.find(objRow=>objRow.id===arrValues[0]).email_verified_at=now();return {};}
  if(strSql.startsWith('UPDATE accounts SET password_hash')){const objAccount=objState.accounts.find(objRow=>String(objRow.id)===String(arrValues[1]));objAccount.password_hash=arrValues[0];if(strSql.includes('email_verified_at'))objAccount.email_verified_at=now();return {};}
  if(strSql.startsWith('UPDATE accounts SET first_name')){Object.assign(objState.accounts.find(objRow=>String(objRow.id)===String(arrValues[3])),{first_name:arrValues[0],last_name:arrValues[1],phone:arrValues[2]});return {};}
  if(strSql.startsWith('UPDATE accounts SET role')){Object.assign(objState.accounts.find(objRow=>String(objRow.id)===String(arrValues[2])),{role:arrValues[0],disabled_at:arrValues[1]?now():null});return {};}
  throw Error('Unimplemented test query: '+strSql);
 }
 return {get state(){return objState},pool:{query,getConnection:async()=>{let objSaved;return {query,beginTransaction:async()=>{objSaved=structuredClone(objState)},commit:async()=>{},rollback:async()=>{objState=objSaved},release(){}}}}};
}
const objConfig={siteUrl:'https://pizza.example',mailKey:'test-only',mailFrom:'accounts@pizza.example'};
const objProfile={firstName:'Ada',lastName:'Lovelace',email:'ada@example.com',phone:'5551234567',password:'a very long testing password'};
const request=(strToken='')=>({headers:{cookie:strToken?'luigi_session='+strToken:''},socket:{remoteAddress:'127.0.0.1'}});
const tokenFromMail=objMail=>new URLSearchParams(new URL(objMail.message.split('\n')[1]).hash.slice(1)).get('token');
test('registration, email verification, session rotation, profile, password recovery and logout',async()=>{
 const objStore=createStore(),objService=createAccountService(objStore.pool,objConfig);
 const objRegister=await objService.handle(request(),'/api/auth/register',objProfile);assert.equal(objRegister.status,201);assert.match(objRegister.data.message,/Account created.*verify/);assert.equal(objStore.state.accounts[0].email_verified_at,null);assert.notEqual(objStore.state.accounts[0].password_hash,objProfile.password);
 await assert.rejects(objService.handle(request(),'/api/auth/login',objProfile),objError=>objError.status===403);
 const strVerify=tokenFromMail(objStore.state.mail[0]);assert.equal(objStore.state.actions[0].token_hash,digestToken(strVerify));
 await objService.handle(request(),'/api/auth/verify',{token:strVerify});
 await assert.rejects(objService.handle(request(),'/api/auth/verify',{token:strVerify}),objError=>objError.status===400);
 const objLogin=await objService.handle(request(),'/api/auth/login',objProfile);const strToken=objLogin.cookie.match(/luigi_session=([^;]+)/)[1];assert.match(objLogin.cookie,/HttpOnly/);assert.match(objLogin.cookie,/Secure/);assert.match(objLogin.cookie,/SameSite=Lax/);assert.equal(objStore.state.sessions[0].token_hash,digestToken(strToken));assert.equal((await objService.identity(request(strToken))).role,'customer');
 const objProfileResult=await objService.handle(request(strToken),'/api/auth/profile',{...objProfile,phone:'+1 555 999 1234',email:'stolen@example.com'});assert.equal(objProfileResult.data.user.email,objProfile.email);assert.equal(objProfileResult.data.user.phone,'+1 555 999 1234');
 const objUnknown=await objService.handle(request(),'/api/auth/forgot',{email:'unknown@example.com'});const objKnown=await objService.handle(request(),'/api/auth/forgot',{email:objProfile.email});assert.deepEqual(objUnknown,objKnown);
 await objService.handle(request(),'/api/auth/reset',{token:tokenFromMail(objStore.state.mail.at(-1)),password:'another long testing password'});assert.equal(await objService.identity(request(strToken)),null);
 await assert.rejects(objService.handle(request(),'/api/auth/login',objProfile),objError=>objError.status===401);
 const objNewLogin=await objService.handle(request(),'/api/auth/login',{...objProfile,password:'another long testing password'}),strNewToken=objNewLogin.cookie.match(/luigi_session=([^;]+)/)[1];
 await objService.handle(request(strNewToken),'/api/auth/logout',{});assert.equal(await objService.identity(request(strNewToken)),null);
});
test('registration rejects duplicate email with 409 without creating more accounts or verification emails',async()=>{
 const objStore=createStore(),objService=createAccountService(objStore.pool,objConfig);
 await objService.handle(request(),'/api/auth/register',objProfile);
 await assert.rejects(objService.handle(request(),'/api/auth/register',{...objProfile,email:'ADA@example.com'}),objError=>objError.status===409&&objError.message==='An account with this email already exists.');
 assert.equal(objStore.state.accounts.length,1);assert.equal(objStore.state.mail.length,1);
 assert.equal(objStore.state.actions.length,1);assert.equal(objStore.state.audit.length,1);
});

test('registration returns specific validation errors before any database writes',async()=>{
 const objStore=createStore(),objService=createAccountService(objStore.pool,objConfig);
 for(const [objChange,strMessage] of [[{email:'bad'},'Enter a valid email address.'],[{password:'short'},'Use a password between 12 and 128 characters.']]){
  await assert.rejects(objService.handle(request(),'/api/auth/register',{...objProfile,...objChange}),objError=>objError.status===400&&objError.message===strMessage);
 }
 assert.equal(objStore.state.accounts.length,0);assert.equal(objStore.state.throttles.size,0);
});

test('registration rolls back and propagates unexpected database failures',async()=>{
 const objStore=createStore(),objFailure=new Error('test database failure');
 const objPool={...objStore.pool,getConnection:async()=>{
  const objConnection=await objStore.pool.getConnection(),fnQuery=objConnection.query;
  objConnection.query=async(strSql,arrValues)=>{if(strSql.startsWith('INSERT INTO account_mail'))throw objFailure;return fnQuery(strSql,arrValues);};
  return objConnection;
 }};
 await assert.rejects(createAccountService(objPool,objConfig).handle(request(),'/api/auth/register',objProfile),objError=>objError===objFailure);
 assert.equal(objStore.state.accounts.length,0);assert.equal(objStore.state.actions.length,0);
});

test('admin invitations, self-protection, role updates, disabled login and session revocation',async()=>{
 const objStore=createStore();objStore.state.accounts.push({id:1,email:'owner@example.com',first_name:'Owner',last_name:'Admin',phone:'5551234567',password_hash:await hashPassword(objProfile.password),role:'admin',email_verified_at:new Date().toISOString(),disabled_at:null});objStore.state.sessions.push({token_hash:digestToken('a'.repeat(64)),account_id:1});
 const objService=createAccountService(objStore.pool,objConfig),objRequest=request('a'.repeat(64));
 await objService.handle(objRequest,'/api/admin/accounts/invite',{...objProfile,role:'admin',currentPassword:objProfile.password});assert.equal(objStore.state.accounts[1].password_hash,null);
 await objService.handle(request(),'/api/auth/accept-invite',{token:tokenFromMail(objStore.state.mail[0]),password:objProfile.password});
 const objStaff=await objService.handle(request(),'/api/auth/login',objProfile),strToken=objStaff.cookie.match(/luigi_session=([^;]+)/)[1];
 await assert.rejects(objService.handle(objRequest,'/api/admin/accounts/update',{id:'1',role:'customer',disabled:true,currentPassword:objProfile.password}),objError=>objError.status===409);
 await objService.handle(objRequest,'/api/admin/accounts/update',{id:'2',role:'customer',disabled:true,currentPassword:objProfile.password});assert.equal(await objService.identity(request(strToken)),null);
 await assert.rejects(objService.handle(request(),'/api/auth/login',objProfile),objError=>objError.status===401);
});
test('login rate limiting rejects repeated failures before unbounded password work',async()=>{
 const objStore=createStore(),objService=createAccountService(objStore.pool,objConfig);
 for(let nAttempt=0;nAttempt<10;nAttempt++)await assert.rejects(objService.handle(request(),'/api/auth/login',{email:'missing@example.com',password:'wrong'}),objError=>objError.status===401);
 await assert.rejects(objService.handle(request(),'/api/auth/login',{email:'missing@example.com',password:'wrong'}),objError=>objError.status===429);
});
test('email outbox clears sensitive message after delivery and retries provider failures',async objTest=>{
 const objStore=createStore(),objService=createAccountService(objStore.pool,objConfig);await objService.handle(request(),'/api/auth/register',objProfile);
 const objFetch=objTest.mock.method(globalThis,'fetch',async()=>({ok:false}));await deliverAccountMail(objStore.pool,objConfig);assert.equal(objStore.state.mail[0].attempts,1);assert.ok(objStore.state.mail[0].message.includes('#action=verify'));
 objFetch.mock.mockImplementation(async(strUrl,objOptions)=>{assert.equal(strUrl,'https://api.resend.com/emails');assert.equal(objOptions.headers['Idempotency-Key'],objStore.state.mail[0].id);return {ok:true};});await deliverAccountMail(objStore.pool,objConfig);assert.equal(objStore.state.mail[0].message,'');assert.ok(objStore.state.mail[0].sent_at);
});
