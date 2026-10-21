import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMenuProxy} from '../menu-proxy.js';

function harness(objOverrides={}){
 const arrCalls=[];let nBodyReads=0;
 const fnProxy=createMenuProxy({siteUrl:'https://pizza.example',staffUser:'internal',staffPassword:'private-service-password',
  resolveIdentity:async()=>({role:'admin',email:'admin@example.test'}),
  readBody:async objRequest=>{nBodyReads++;return objRequest.input;},
  fetch:async(objUrl,objOptions)=>{arrCalls.push({url:objUrl.href,...objOptions});return new Response(JSON.stringify({ok:true}),{status:200});},
  ...objOverrides});
 return {arrCalls,get bodyReads(){return nBodyReads;},
  request(strMethod='GET',strPath='/api/admin/menu',objInput, objHeaders={}){
   return fnProxy({method:strMethod,headers:{origin:'https://pizza.example',...objHeaders},input:objInput},new URL(strPath,'https://pizza.example'));
  }};
}

test('menu proxy denies guests, customers and forged role headers before parsing or forwarding',async()=>{
 for(const objIdentity of [null,{role:'customer',email:'customer@example.test'}]){
  const objHarness=harness({resolveIdentity:async()=>objIdentity});
  for(const [strMethod,strPath] of [['GET','/api/admin/menu'],['POST','/api/admin/menu'],['PATCH','/api/admin/menu/side/Knots'],['DELETE','/api/admin/menu/side/Knots']]){
   const objResult=await objHarness.request(strMethod,strPath,{confirmation:'DELETE Knots'},
    {authorization:'Basic forged','x-luigi-actor':'admin@example.test','x-role':'admin'});
   assert.equal(objResult.status,403);
  }
  assert.equal(objHarness.arrCalls.length,0);assert.equal(objHarness.bodyReads,0);
 }
});

test('menu proxy forwards each supported operation with trusted credentials and exact confirmation',async()=>{
 const objHarness=harness();
 for(const [strMethod,strPath,objInput] of [
  ['GET','/api/admin/menu'],['POST','/api/admin/menu',{category:'side',name:'Knots',priceCents:700}],
  ['PATCH','/api/admin/menu/side/Garlic%20Knots',{name:'New Knots',description:'Fresh garlic',priceCents:800}],
  ['DELETE','/api/admin/menu/side/Garlic%20Knots',{confirmation:'DELETE Garlic Knots'}],
 ]){
  assert.equal((await objHarness.request(strMethod,strPath,objInput,
   {authorization:'Basic forged','x-luigi-actor':'forged@example.test'})).status,200);
  const objCall=objHarness.arrCalls.at(-1);
  assert.equal(objCall.url,'http://127.0.0.1:8000'+strPath);
  assert.equal(objCall.method,strMethod);assert.equal(objCall.redirect,'error');
  assert.equal(objCall.headers.Authorization,'Basic '+Buffer.from('internal:private-service-password').toString('base64'));
  assert.equal(objCall.headers['X-Luigi-Actor'],'admin@example.test');
  assert.deepEqual(objCall.body?JSON.parse(objCall.body):undefined,objInput);
 }
});

test('menu mutations reject missing and foreign origins before sending internal credentials',async()=>{
 const objHarness=harness();
 for(const strMethod of ['POST','PATCH','DELETE']){
  const strPath=strMethod==='POST'?'/api/admin/menu':'/api/admin/menu/side/Knots';
  for(const strOrigin of [undefined,'https://other.example','http://pizza.example']){
   assert.equal((await objHarness.request(strMethod,strPath,{}, {origin:strOrigin})).status,403);
  }
 }
 assert.equal(objHarness.arrCalls.length,0);assert.equal(objHarness.bodyReads,0);
});

test('menu proxy rejects malformed bodies and unsupported methods without forwarding',async()=>{
 const objHarness=harness();
 for(const objInput of [null,[],true,'menu'])assert.equal((await objHarness.request('POST','/api/admin/menu',objInput)).status,400);
 assert.equal((await objHarness.request('DELETE','/api/admin/menu',{})).status,405);
 assert.equal((await objHarness.request('POST','/api/admin/menu/side/Knots',{})).status,405);
 assert.equal(await objHarness.request('GET','/api/menu'),null);
 assert.equal(objHarness.arrCalls.length,0);
 const objBrokenBody=harness({readBody:async()=>{throw Error('JSON required');}});
 assert.equal((await objBrokenBody.request('POST','/api/admin/menu',{})).status,400);
});

test('menu proxy preserves backend conflicts and fails closed for outages or missing credentials',async()=>{
 const objConflict=harness({fetch:async()=>new Response(JSON.stringify({error:'Name reserved'}),{status:409})});
 assert.deepEqual(await objConflict.request('POST','/api/admin/menu',{}),{status:409,data:{error:'Name reserved'}});
 for(const fnFetch of [async()=>{throw Error('private network details');},async()=>new Response('not JSON')]){
  const objHarness=harness({fetch:fnFetch});
  const objResult=await objHarness.request();assert.equal(objResult.status,503);
  assert.doesNotMatch(JSON.stringify(objResult),/private network details/);
 }
 const objUnconfigured=harness({staffPassword:''});
 assert.equal((await objUnconfigured.request()).status,503);assert.equal(objUnconfigured.arrCalls.length,0);
});

test('menu proxy refuses remote or credential-bearing backend origins',()=>{
 for(const strUrl of ['https://example.com','http://localhost:8000','http://127.0.0.1:8000/path','http://user:pass@127.0.0.1:8000','http://127.0.0.1:8000?next=remote']){
  assert.throws(()=>harness({lifecycleUrl:strUrl}),/loopback/);
 }
});
