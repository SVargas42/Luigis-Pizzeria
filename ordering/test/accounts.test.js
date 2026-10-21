import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAccountService,digestToken,hashPassword,readSessionToken,validatePassword,validateProfile,verifyPassword} from '../accounts.js';
const objProfile={firstName:' Ada ',lastName:"O'Connor",email:'ADA@example.com',phone:'+1 (555) 123-4567'};
test('signup requires complete names, normalized email, and a real-length phone',()=>{
 assert.deepEqual(validateProfile(objProfile),{firstName:'Ada',lastName:"O'Connor",email:'ada@example.com',phone:'+1 (555) 123-4567'});
 for(const objChange of [{firstName:''},{lastName:''},{email:'bad'},{phone:''},{phone:'123'},{phone:'callme1234567'},{phone:'1234567890123456'},{firstName:'a\u0000b'}])assert.throws(()=>validateProfile({...objProfile,...objChange}));
});
test('scrypt uses unique salts and does not accept a wrong password or malformed stored hash',async()=>{
 const strPassword='A long passphrase for testing';const strHash=await hashPassword(strPassword),strOther=await hashPassword(strPassword);
 assert.notEqual(strHash,strOther);assert.ok(!strHash.includes(strPassword));assert.equal(await verifyPassword(strPassword,strHash),true);assert.equal(await verifyPassword('Wrong password',strHash),false);assert.equal(await verifyPassword(strPassword,null),false);assert.equal(await verifyPassword('x'.repeat(129),strHash),false);
 assert.throws(()=>validatePassword('short'));assert.throws(()=>validatePassword('x'.repeat(129)));assert.equal(validatePassword('correct horse battery staple'),'correct horse battery staple');
});
test('session parser ignores other cookies and rejects malformed bearer tokens',()=>{
 const strToken='a'.repeat(64);assert.equal(readSessionToken({headers:{cookie:`foo=bar; luigi_session=${strToken}; theme=dark`}}),strToken);assert.equal(readSessionToken({headers:{cookie:'luigi_session=admin'}}),null);assert.equal(readSessionToken({headers:{}}),null);assert.notEqual(digestToken(strToken),strToken);
});
test('production origins require HTTPS and cannot carry path or credentials',()=>{
 for(const strUrl of ['http://example.com','https://user:pass@example.com','https://example.com/account'])assert.throws(()=>createAccountService({}, {siteUrl:strUrl}));
 assert.ok(createAccountService({}, {siteUrl:'http://127.0.0.1:3000'}));
});
test('unconfigured mail fails closed for registration; public clients cannot create admins',async()=>{
 const objService=createAccountService({}, {siteUrl:'https://example.com'});
 await assert.rejects(objService.handle({headers:{}},'/api/auth/register',{...objProfile,password:'long enough password'}),objError=>objError.status===503);
 const objEnabled=createAccountService({}, {siteUrl:'https://example.com',mailKey:'test',mailFrom:'test@example.com'});
 await assert.rejects(objEnabled.handle({headers:{}},'/api/auth/register',{...objProfile,password:'long enough password',role:'admin'}),objError=>objError.status===400);
});
test('identity always comes from a hashed, unexpired database session; body/header roles are ignored',async()=>{
 const arrCalls=[];const objPool={async query(strSql,arrParams){arrCalls.push({strSql,arrParams});return [];}};
 const objService=createAccountService(objPool,{siteUrl:'https://example.com'});
 assert.equal(await objService.identity({headers:{'x-role':'admin'}}),null);assert.equal(arrCalls.length,0);
 assert.equal(await objService.identity({headers:{cookie:'luigi_session='+'a'.repeat(64),'x-role':'admin'}}),null);
 assert.match(arrCalls[0].strSql,/expires_at>UTC_TIMESTAMP/);assert.match(arrCalls[0].strSql,/disabled_at IS NULL/);assert.equal(arrCalls[0].arrParams[0],digestToken('a'.repeat(64)));
 await assert.rejects(objService.handle({headers:{}},'/api/admin/accounts/update',{role:'admin'}),objError=>objError.status===401);
});
test('checkout ownership reserves account IDs and rejects stealing a guest or another account order',async()=>{
 const objState={claim:null,existing:null};
 const objConnection={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},release(){},async query(strSql,arrParams){
  if(strSql.startsWith('SELECT a.account_id'))return objState.existing?[objState.existing]:[];
  if(strSql.startsWith('INSERT INTO account_order_claims')){objState.claim??={account_id:arrParams[1]};return {};}
  if(strSql.startsWith('SELECT account_id'))return objState.claim?[objState.claim]:[];
  throw Error('Unexpected query');
 }};
 const objService=createAccountService({getConnection:async()=>objConnection},{siteUrl:'https://example.com'}),strKey='12345678-1234-4123-8123-123456789abc';
 await objService.claimOrder(strKey,{id:'7'});assert.equal(objState.claim.account_id,'7');
 await objService.claimOrder(strKey,{id:'7'});
 await assert.rejects(objService.claimOrder(strKey,{id:'8'}),objError=>objError.status===403);
 await assert.rejects(objService.claimOrder(strKey,null),objError=>objError.status===401);
 objState.claim=null;objState.existing={account_id:null};await objService.claimOrder(strKey,null);
 await assert.rejects(objService.claimOrder(strKey,{id:'7'}),objError=>objError.status===409);
});
