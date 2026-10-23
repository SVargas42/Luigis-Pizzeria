import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {canAccessStaffRoute} from '../admin-access.js';

const strServer=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const strProxy=strServer.slice(strServer.indexOf('  const bLifecycleRoute='),strServer.indexOf("  if (req.method==='GET' && url.pathname==='/api/orders/mine')"));

function harness(objIdentity){
 const arrForwarded=[];let nBodyReads=0,nIdentityReads=0;
 const fnRequest=vm.runInNewContext(`(async function(req,url,res){${strProxy}})`,{
  URL,Buffer,AbortSignal,canAccessStaffRoute,
  process:{env:{LIFECYCLE_URL:'http://127.0.0.1:8000',ADMIN_USER:'internal',ADMIN_PASSWORD:'unit-test-only'}},
  resolveIdentity:async()=>{nIdentityReads++;return objIdentity;},
  body:async()=>{nBodyReads++;return {expectedStatus:'order_received',status:'order_confirmed'};},
  send:(objResponse,nStatus,objData)=>({status:nStatus,data:objData}),
  fetch:async(objUrl,objOptions)=>{arrForwarded.push({url:objUrl.href,...objOptions});return {ok:true,status:200,json:async()=>({status:'order_confirmed'})};}
 });
 return {arrForwarded,get bodyReads(){return nBodyReads;},get identityReads(){return nIdentityReads;},
  request(strPath='/api/employee/orders/7/status',strMethod='PATCH'){
   return fnRequest({method:strMethod,headers:{cookie:'luigi_session='+'a'.repeat(64),authorization:'Basic forged','x-luigi-actor':'admin@example.test','x-luigi-role':'admin'}},new URL(strPath,'https://pizza.example'),{});
  }};
}

test('proxy rejects customers and guests before reading the body or forwarding credentials',async()=>{
 for(const objIdentity of [null,{role:'customer',email:'customer@example.test'},{role:'owner',email:'owner@example.test'}]){
  const objHarness=harness(objIdentity);
  for(const [strPath,strMethod] of [['status','PATCH'],['estimate','PATCH'],['complete','POST']]){
   assert.equal((await objHarness.request(`/api/employee/orders/7/${strPath}`,strMethod)).status,403);
  }
  assert.equal(objHarness.bodyReads,0);assert.equal(objHarness.arrForwarded.length,0);
 }
});

test('proxy forwards only a current worker/admin identity and its session to FastAPI',async()=>{
 for(const strRole of ['worker','admin']){
  const objHarness=harness({role:strRole,email:'staff@example.test'});
  assert.equal((await objHarness.request()).status,200);
  assert.equal(objHarness.identityReads,1);assert.equal(objHarness.bodyReads,1);
  const objForwarded=objHarness.arrForwarded[0];
  assert.equal(objForwarded.headers.Cookie,'luigi_session='+'a'.repeat(64));
  assert.equal(objForwarded.headers['X-Luigi-Actor'],'staff@example.test');
  assert.notEqual(objForwarded.headers.Authorization,'Basic forged');
 }
});

test('worker route allowlist still rejects unsupported methods',async()=>{
 const objHarness=harness({role:'worker',email:'staff@example.test'});
 assert.equal((await objHarness.request('/api/employee/orders/7/status','POST')).status,403);
 assert.equal(objHarness.arrForwarded.length,0);
});
