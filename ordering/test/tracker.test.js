import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const strSource=readFileSync(new URL('../public/tracker.js',import.meta.url),'utf8');
function trackerHarness(){
 const mapElements=new Map(),arrRequests=[];let fnPoll,nRequests=0,bFailure=false;
 const objOrder={orderNumber:'LP-7',status:'order_received',estimatedPickupTime:null};
 function getElement(strId){if(!mapElements.has(strId))mapElements.set(strId,{textContent:'',style:{},attrs:{},children:[],handlers:{},setAttribute(strName,strValue){this.attrs[strName]=strValue;},addEventListener(strName,fnHandler){this.handlers[strName]=fnHandler;},replaceChildren(){this.children=[];},append(objChild){this.children.push(objChild);}});return mapElements.get(strId);}
 const objContext={document:{hidden:false,getElementById:getElement,createElement(){return getElement(`child-${Math.random()}`);}},location:{search:'?token='+'a'.repeat(64)},URLSearchParams,setInterval(fnHandler){fnPoll=fnHandler;},fetch:async(strPath,objOptions={})=>{arrRequests.push({path:strPath,...objOptions});nRequests++;return {ok:!bFailure,json:async()=>bFailure?{error:'Temporary outage'}:objOrder};}};
 vm.runInNewContext(strSource,objContext);
 return {mapElements,objOrder,getElement,arrRequests,get nRequests(){return nRequests;},poll(){fnPoll();},fail(){bFailure=true;},recover(){bFailure=false;}};
}
const settle=()=>new Promise(fnResolve=>setImmediate(fnResolve));
test('customer tracker interactions only read tracking data and never send mutations',async()=>{
 const objHarness=trackerHarness();await settle();
 await objHarness.getElement('tracker-refresh').handlers.click();
 objHarness.getElement('tracker-pause').handlers.click();objHarness.poll();await settle();
 objHarness.getElement('tracker-pause').handlers.click();objHarness.poll();await settle();
 assert.equal(objHarness.arrRequests.length,3);
 for(const objRequest of objHarness.arrRequests){
  assert.equal(objRequest.method||'GET','GET');
  assert.equal(objRequest.path,`/api/orders/${'a'.repeat(64)}/track`);
  assert.equal(objRequest.body,undefined);
 }
});
test('pickup estimate changes independently of status and unchanged polls do not repeat it',async()=>{
 const objHarness=trackerHarness();await settle();
 const objEstimate=objHarness.getElement('tracker-estimate');
 let strEstimate=objEstimate.textContent,nEstimateWrites=0;
 Object.defineProperty(objEstimate,'textContent',{
  get:()=>strEstimate,set(strValue){strEstimate=strValue;nEstimateWrites++;}
 });
 objHarness.poll();await settle();assert.equal(nEstimateWrites,0);
 objHarness.objOrder.estimatedPickupTime='2026-10-22T20:30:00Z';
 objHarness.poll();await settle();
 assert.ok(strEstimate.includes(new Date(objHarness.objOrder.estimatedPickupTime).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})));assert.equal(nEstimateWrites,1);
 assert.equal(objHarness.getElement('tracker-message').textContent,'Order received');
 objHarness.poll();await settle();assert.equal(nEstimateWrites,1);
 objHarness.objOrder.estimatedPickupTime=null;objHarness.poll();await settle();
 assert.equal(strEstimate,'Calculating...');assert.equal(nEstimateWrites,2);
});
test('tracker renders five stages, polls estimates and supports pause and manual refresh',async()=>{
 const objHarness=trackerHarness();await settle();
 assert.equal(objHarness.getElement('tracker-stages').children.length,5);
 assert.deepEqual(objHarness.getElement('tracker-stages').children.slice(2).map(objStep=>objStep.textContent),['Preparing','Cooking','Ready']);
 assert.equal(objHarness.getElement('tracker-progress').attrs['aria-valuenow'],'1');
 assert.equal(objHarness.getElement('tracker-estimate').textContent,'Calculating...');
 objHarness.objOrder.status='cooking_order';objHarness.objOrder.estimatedPickupTime='2026-10-17T00:00:00Z';objHarness.poll();await settle();
 assert.equal(objHarness.getElement('tracker-progress').attrs['aria-valuenow'],'4');
 assert.equal(objHarness.getElement('tracker-message').textContent,'Cooking');
 assert.equal(objHarness.getElement('tracker-stages').children[3].textContent,'Cooking');
 assert.equal(objHarness.getElement('tracker-stages').children[3].attrs['aria-current'],'step');
 assert.equal(objHarness.getElement('tracker-fill').style.width,'80%');
 assert.ok(objHarness.getElement('tracker-estimate').textContent.includes('2026'));
 objHarness.getElement('tracker-pause').handlers.click();objHarness.poll();await settle();assert.equal(objHarness.nRequests,2);
 await objHarness.getElement('tracker-refresh').handlers.click();assert.equal(objHarness.nRequests,3);
 objHarness.getElement('tracker-pause').handlers.click();objHarness.fail();objHarness.poll();await settle();assert.match(objHarness.getElement('tracker-message').textContent,/retry/);
 objHarness.recover();objHarness.objOrder.status='order_ready';objHarness.poll();await settle();assert.equal(objHarness.getElement('tracker-progress').attrs['aria-valuenow'],'5');
});

test('ready orders keep polling until pickup, then stop with every stage complete',async()=>{
 const objHarness=trackerHarness();await settle();
 objHarness.objOrder.status='order_ready';objHarness.poll();await settle();
 assert.equal(objHarness.getElement('tracker-stages').children[4].attrs['aria-current'],'step');
 objHarness.objOrder.completed=true;objHarness.poll();await settle();
 assert.equal(objHarness.getElement('tracker-message').textContent,'Your order has been picked up.');
 assert.ok(objHarness.getElement('tracker-stages').children.every(objStep=>objStep.className==='is-complete'));
 const nRequests=objHarness.nRequests;objHarness.poll();await settle();assert.equal(objHarness.nRequests,nRequests);
});

test('cancelled orders have no active or completed stage and stop automatic polling',async()=>{
 const objHarness=trackerHarness();await settle();objHarness.objOrder.cancelled=true;objHarness.poll();await settle();
 assert.equal(objHarness.getElement('tracker-progress').attrs['data-state'],'cancelled');
 assert.equal(objHarness.getElement('tracker-message').textContent,'This order was cancelled.');
 assert.ok(objHarness.getElement('tracker-stages').children.every(objStep=>objStep.className==='is-upcoming'));
 const nRequests=objHarness.nRequests;objHarness.poll();await settle();assert.equal(objHarness.nRequests,nRequests);
});

test('pickup estimate uses today in local time and handles invalid values',async()=>{
 const objHarness=trackerHarness();await settle();
 objHarness.objOrder.estimatedPickupTime=new Date().toISOString();objHarness.poll();await settle();
 assert.match(objHarness.getElement('tracker-estimate').textContent,/^Today at /);
 objHarness.objOrder.estimatedPickupTime='invalid';objHarness.poll();await settle();
 assert.equal(objHarness.getElement('tracker-estimate').textContent,'Calculating...');
});

test('pickup estimate appears before progress and retains an accessible live region',()=>{
 const strHtml=readFileSync(new URL('../public/tracker.html',import.meta.url),'utf8');
 assert.equal((strHtml.match(/id="tracker-estimate"/g)||[]).length,1);
 assert.ok(strHtml.indexOf('id="tracker-estimate"')<strHtml.indexOf('id="tracker-message"'));
 assert.match(strHtml,/<h2>Estimated Pickup Time<\/h2>/);
 assert.match(strHtml,/id="tracker-estimate" role="status" aria-live="polite" aria-atomic="true"/);
});

test('employee pickup minimum advances on keyboard, pointer and submit in local time',()=>{
 const strHtml=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
 const strControl=strHtml.match(/const updateEstimateMinimum=\(\)=>\{[\s\S]*?for\(const strEvent of \['focus','click','keydown'\]\)objEstimate.addEventListener\(strEvent,updateEstimateMinimum\);/)[0];
 let nNow=Date.now();const mapHandlers=new Map(),objEstimate={};
 class TestDate extends Date{constructor(...arrArgs){super(...(arrArgs.length?arrArgs:[nNow]));}static now(){return nNow;}}
 vm.runInNewContext(strControl,{Date:TestDate,objEstimate:{...objEstimate,addEventListener(strEvent,fnHandler){mapHandlers.set(strEvent,fnHandler);Object.defineProperty(objEstimate,'min',{get:()=>this.min,configurable:true});}}});
 const expectedMinimum=()=>{const dtMinimum=new Date(Math.ceil(nNow/60000)*60000);return new Date(dtMinimum.getTime()-dtMinimum.getTimezoneOffset()*60000).toISOString().slice(0,16);};
 assert.equal(objEstimate.min,expectedMinimum());
 for(const strEvent of ['focus','click','keydown']){nNow+=120000;mapHandlers.get(strEvent)();assert.equal(objEstimate.min,expectedMinimum());}
 assert.match(strHtml,/objEvent.preventDefault\(\);updateEstimateMinimum\(\);/);
 assert.ok(strHtml.includes('!objEstimate.checkValidity()'));
 assert.ok(strHtml.includes('dtPickup.getTime()<=Date.now()'));
});
