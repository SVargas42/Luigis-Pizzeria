import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const strScript=readFileSync(new URL('../public/staff.js',import.meta.url),'utf8');
async function fixture(strRole='worker'){
 const mapElements=new Map(),arrRequests=[],mapTimers=new Map();let nTimer=0,nFailure=0,nNow=Date.now();
 class StaffDate extends Date{constructor(...arrArgs){super(...(arrArgs.length?arrArgs:[nNow]));}static now(){return nNow;}}
 function createElement(){return {children:[],handlers:{},append(...arrChildren){this.children.push(...arrChildren);},replaceChildren(){this.children=[];},setAttribute(strName,strValue){this[strName]=strValue;},addEventListener(strName,fnHandler){this.handlers[strName]=fnHandler;},removeAttribute(strName){delete this[strName];},checkValidity(){return Boolean(this.value)&&this.value>=this.min;},focus(){this.bFocused=true;},contains(){return false;}};}
 function getElement(strId){if(!mapElements.has(strId))mapElements.set(strId,createElement());return mapElements.get(strId);}
 const objOrder={id:7,tracking_status:'order_received',customer_name:'<script>alert(1)</script>',customer_email:'worker-test@example.com',total_cents:1300,items:[{quantity:2,description:'Pizza Bites'}]};
 const objContext={Date:StaffDate,setTimeout(fnHandler,nDelay){mapTimers.set(++nTimer,{fnHandler,nDelay});return nTimer;},clearTimeout(nId){mapTimers.delete(nId);},document:{getElementById:getElement,createElement},setInterval(){},fetch:async(strPath,objOptions)=>{arrRequests.push({strPath,...objOptions});if(nFailure&&objOptions.method!=='GET')return {ok:false,status:nFailure,json:async()=>({error:'Server unavailable'})};return {ok:true,json:async()=>strPath==='/api/session'?{authenticated:true,user:{role:strRole,firstName:'Kitchen',lastName:'Worker'}}:strPath.endsWith('/active')?[objOrder]:{}};}};
 vm.createContext(objContext);vm.runInContext(strScript,objContext);await new Promise(fnResolve=>setImmediate(fnResolve));return {objContext,getElement,arrRequests,objOrder,mapTimers,fail(nStatus){nFailure=nStatus;},advance(nMilliseconds){nNow+=nMilliseconds;},get nNow(){return nNow;}};
}
test('worker queue sends sequential actions, UTC estimates and pickup completion',async()=>{
 const {objContext,getElement,arrRequests,objOrder}=await fixture();
 assert.equal(getElement('staff-admin-link').hidden,true);
 let objCard=getElement('staff-orders').children[0];assert.equal(objCard.children[0].textContent,objOrder.customer_name?`LP-7 · ${objOrder.customer_name}`:'');
 objCard.children.find(objChild=>objChild.className==='actions').children[0].handlers.click();await new Promise(fnResolve=>setImmediate(fnResolve));
 assert.deepEqual(JSON.parse(arrRequests.find(objRequest=>objRequest.strPath.endsWith('/status')).body),{expectedStatus:'order_received',status:'order_confirmed'});
 objCard=getElement('staff-orders').children[0];const objForm=objCard.children.find(objChild=>objChild.handlers.submit);objForm.children[1].value='2099-01-01T12:00';objForm.handlers.submit({preventDefault(){}});await new Promise(fnResolve=>setImmediate(fnResolve));
 assert.deepEqual(JSON.parse(arrRequests.find(objRequest=>objRequest.strPath.endsWith('/estimate')).body),{estimatedPickupTime:new Date('2099-01-01T12:00').toISOString()});
 objOrder.tracking_status='order_ready';await vm.runInContext('refreshStaffQueue()',objContext);objCard=getElement('staff-orders').children[0];objCard.children.find(objChild=>objChild.className==='actions').children[0].handlers.click();await new Promise(fnResolve=>setImmediate(fnResolve));
 const objComplete=arrRequests.find(objRequest=>objRequest.strPath.endsWith('/complete'));assert.equal(objComplete.method,'POST');assert.deepEqual(JSON.parse(objComplete.body),{expectedStatus:'order_ready'});
 assert.ok(!arrRequests.some(objRequest=>objRequest.strPath.startsWith('/api/admin')));
});
test('customer cannot load kitchen data and workers can pause automatic updates',async()=>{
 const objCustomer=await fixture('customer');assert.equal(objCustomer.arrRequests.length,1);assert.match(objCustomer.getElement('staff-message').textContent,/worker or administrator/);
 const objWorker=await fixture();objWorker.getElement('staff-pause').handlers.click();assert.equal(objWorker.getElement('staff-pause')['aria-pressed'],'true');
});

const settle=()=>new Promise(fnResolve=>setImmediate(fnResolve));
const estimateForm=objHarness=>objHarness.getElement('staff-orders').children[0].children.find(objChild=>objChild.handlers.submit);
const strPickupError='Invalid time: You cannot select a pickup time in the past.';

test('worker invalid estimates stay local, announce exact warning and expire after 3.5 seconds',async()=>{
 const objHarness=await fixture(),objForm=estimateForm(objHarness);
 const [,objInput,objSave,objAlert]=objForm.children;
 assert.equal(objForm.noValidate,true);assert.equal(objAlert.hidden,true);
 assert.equal(objAlert.role,'alert');assert.equal(objInput['aria-describedby'],objAlert.id);
 for(const strValue of ['', 'invalid', '2020-01-01T12:00']){
  objInput.value=strValue;const nRequests=objHarness.arrRequests.length;
  objForm.handlers.submit({preventDefault(){}});await settle();
  assert.equal(objHarness.arrRequests.length,nRequests);assert.equal(objAlert.textContent,strPickupError);
  assert.equal(objAlert.hidden,false);assert.equal(objInput['aria-invalid'],'true');assert.equal(objInput.bFocused,true);
  assert.equal(objHarness.mapTimers.size,1);const [nId,objTimer]=[...objHarness.mapTimers][0];
  assert.equal(objTimer.nDelay,3500);objHarness.mapTimers.delete(nId);objTimer.fnHandler();
  assert.equal(objAlert.hidden,true);assert.equal(objAlert.textContent,'');
 }
 objInput.handlers.input();assert.equal(objInput['aria-invalid'],undefined);
 assert.notEqual(objSave.disabled,true);
});

test('worker minimum updates on pointer, keyboard and save as time passes',async()=>{
 const objHarness=await fixture(),objForm=estimateForm(objHarness),objInput=objForm.children[1];
 const localMinimum=()=>{const dtMinimum=new Date(Math.ceil(objHarness.nNow/60000)*60000);return new Date(dtMinimum.getTime()-dtMinimum.getTimezoneOffset()*60000).toISOString().slice(0,16);};
 assert.equal(objInput.min,localMinimum());
 for(const strEvent of ['focus','click','keydown']){objHarness.advance(120000);objInput.handlers[strEvent]();assert.equal(objInput.min,localMinimum());}
 objInput.value=localMinimum();objHarness.advance(120000);
 const nRequests=objHarness.arrRequests.length;objForm.handlers.submit({preventDefault(){}});await settle();
 assert.equal(objHarness.arrRequests.length,nRequests);assert.equal(objInput.min,localMinimum());
 assert.equal(objForm.children[3].textContent,strPickupError);
});

test('worker server 400 uses pickup alert, retries reset timer and other failures remain distinct',async()=>{
 const objHarness=await fixture(),objForm=estimateForm(objHarness),[,objInput,objSave,objAlert]=objForm.children;
 objInput.value='2099-01-01T12:00';objHarness.fail(400);
 objForm.handlers.submit({preventDefault(){}});await settle();
 assert.equal(objAlert.hidden,false);assert.equal(objAlert.textContent,strPickupError);assert.equal(objSave.disabled,false);
 const fnOldTimer=[...objHarness.mapTimers.values()][0].fnHandler;
 objForm.handlers.submit({preventDefault(){}});await settle();
 assert.equal(objHarness.mapTimers.size,1);assert.notEqual([...objHarness.mapTimers.values()][0].fnHandler,fnOldTimer);
 objInput.handlers.input();assert.equal(objAlert.hidden,true);assert.equal(objInput['aria-invalid'],undefined);assert.equal(objHarness.mapTimers.size,0);
 objHarness.fail(500);objForm.handlers.submit({preventDefault(){}});await settle();
 assert.equal(objAlert.hidden,true);assert.equal(objHarness.getElement('staff-message').textContent,'Server unavailable');
 objHarness.fail(0);objForm.handlers.submit({preventDefault(){}});await settle();
 assert.equal(objSave.disabled,false);assert.equal(objHarness.getElement('staff-message').textContent,'Order updated.');
 assert.equal(objHarness.mapTimers.size,0);
 const objNextForm=estimateForm(objHarness);objHarness.fail(400);
 objHarness.getElement('staff-orders').children[0].children.find(objChild=>objChild.className==='actions').children[0].handlers.click();await settle();
 assert.equal(objNextForm.children[3].hidden,true);assert.equal(objHarness.getElement('staff-message').textContent,'Server unavailable');
});

test('employee invalid styles and alert are scoped without changing keyboard focus rules',()=>{
 const strHtml=readFileSync(new URL('../public/staff.html',import.meta.url),'utf8');
 assert.match(strHtml,/\.estimate-form input:invalid,\.estimate-form input:out-of-range,\.estimate-form input\[aria-invalid="true"\]\{background-color:#e9ecef;color:#595f64;border-color:#6c757d\}/);
 assert.match(strHtml,/\.estimate-form \.alert-danger\{/);
 assert.ok(strHtml.includes(':focus-visible{outline:3px solid #245d84;outline-offset:4px}'));
});
