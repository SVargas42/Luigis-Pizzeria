import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Deployed scripts run against an isolated DOM/API fixture; no real accounts are created.
const strOrigin=process.env.TEST_ORIGIN;
const [strHtml,strScript]=await Promise.all(['account.html','account.js'].map(strName=>strOrigin
 ? fetch(strOrigin+(strName==='account.html'?'/account?mode=register':'/account.js')).then(objResponse=>{assert.equal(objResponse.ok,true);return objResponse.text();})
 : readFile(new URL('../public/'+strName,import.meta.url),'utf8')));

async function createFixture(strMode='register'){
 const mapElements=new Map(),arrRequests=[];
 let objFocused=null,nStatus=201,objBody={message:'Account created.'};
 function getElement(strId){
  if(!mapElements.has(strId))mapElements.set(strId,{value:'',hidden:true,required:false,disabled:false,textContent:'',className:'',classList:{add(){}},focus(){objFocused=this;},reportValidity(){return true;},addEventListener(){}});
  return mapElements.get(strId);
 }
 const objContext={document:{getElementById:getElement},location:{search:'?mode='+strMode,hash:'',pathname:'/account'},URLSearchParams,fetch:async(strPath,objOptions)=>{
  if(strPath==='/api/session')return {ok:true,json:async()=>({authenticated:false})};
  arrRequests.push({strPath,objInput:JSON.parse(objOptions.body)});
  if(nStatus===0)throw Error('Network failure');
  return {status:nStatus,ok:nStatus===201,json:async()=>objBody};
 }};
 vm.runInNewContext(strScript,objContext);
 await new Promise(fnResolve=>setImmediate(fnResolve));
 getElement('password').value='a long test passphrase';
 getElement('confirmPassword').value='a long test passphrase';
 return {getElement,arrRequests,getFocused:()=>objFocused,setResponse(nValue,objValue){nStatus=nValue;objBody=objValue;},async submit(){let bPrevented=false;await getElement('account-form').onsubmit({preventDefault(){bPrevented=true;}});assert.equal(bPrevented,true);}};
}

test('confirmation input is labeled and immediately follows password field',()=>{
 assert.match(strHtml, /id="password-field"[^\n]*\r?\n<div id="confirm-password-field" hidden>/);
 assert.match(strHtml, /<label for="confirmPassword">Confirm Password<\/label>/);
 assert.match(strHtml, /<input id="confirmPassword"[^>]*type="password"[^>]*autocomplete="new-password"/);
});

test('exact password mismatch blocks requests and allows correction',async()=>{
 const objFixture=await createFixture();
 assert.equal(objFixture.getElement('confirm-password-field').hidden,false);
 assert.equal(objFixture.getElement('confirmPassword').required,true);
 for(const strValue of ['a long test passphrasE','a long test passphrase ','']){
  objFixture.getElement('confirmPassword').value=strValue;await objFixture.submit();
  assert.equal(objFixture.arrRequests.length,0);
  assert.equal(objFixture.getElement('register-alert').textContent,'Passwords do not match.');
  assert.equal(objFixture.getElement('register-alert').className,'alert alert-danger');
  assert.equal(objFixture.getFocused(),objFixture.getElement('register-alert'));
  assert.equal(objFixture.getElement('submit').disabled,false);
 }
 objFixture.getElement('confirmPassword').value='a long test passphrase';await objFixture.submit();
 assert.equal(objFixture.arrRequests.length,1);
 assert.equal(objFixture.arrRequests[0].strPath,'/api/auth/register');
 assert.equal(Object.hasOwn(objFixture.arrRequests[0].objInput,'confirmPassword'),false);
 assert.equal(objFixture.getElement('account-form').hidden,true);
 assert.equal(objFixture.getElement('confirmPassword').value,'');
 assert.equal(objFixture.getElement('password').value,'');
 assert.equal(objFixture.getElement('register-alert').className,'alert alert-success');
});

test('matching passwords preserve rejection, network and retry alerts',async()=>{
 const objFixture=await createFixture();
 for(const nStatus of [400,409,429,503,0]){
  objFixture.setResponse(nStatus,{error:'Registration rejected.'});await objFixture.submit();
  assert.equal(objFixture.getElement('register-alert').className,'alert alert-danger');
  assert.match(objFixture.getElement('register-alert').textContent,nStatus===0?/Unable to complete registration/:/Registration rejected/);
  assert.equal(objFixture.getElement('account-form').hidden,false);
  assert.equal(objFixture.getElement('submit').disabled,false);
 }
 objFixture.setResponse(201,{message:'Account created.'});await objFixture.submit();
 assert.equal(objFixture.getElement('register-alert').className,'alert alert-success');
});

test('confirmation is hidden and optional outside registration',async()=>{
 for(const strMode of ['login','forgot','resend','reset','invite','password','profile']){
  const objFixture=await createFixture(strMode);
  assert.equal(objFixture.getElement('confirm-password-field').hidden,true);
  assert.equal(objFixture.getElement('confirmPassword').required,false);
 }
});
