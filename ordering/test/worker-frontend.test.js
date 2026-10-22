import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const strScript=readFileSync(new URL('../public/staff.js',import.meta.url),'utf8');
async function fixture(strRole='worker'){
 const mapElements=new Map(),arrRequests=[];
 function createElement(){return {children:[],handlers:{},append(...arrChildren){this.children.push(...arrChildren);},replaceChildren(){this.children=[];},setAttribute(strName,strValue){this[strName]=strValue;},addEventListener(strName,fnHandler){this.handlers[strName]=fnHandler;},focus(){},contains(){return false;}};}
 function getElement(strId){if(!mapElements.has(strId))mapElements.set(strId,createElement());return mapElements.get(strId);}
 const objOrder={id:7,tracking_status:'order_received',customer_name:'<script>alert(1)</script>',customer_email:'worker-test@example.com',total_cents:1300,items:[{quantity:2,description:'Pizza Bites'}]};
 const objContext={document:{getElementById:getElement,createElement},setInterval(){},fetch:async(strPath,objOptions)=>{arrRequests.push({strPath,...objOptions});return {ok:true,json:async()=>strPath==='/api/session'?{authenticated:true,user:{role:strRole,firstName:'Kitchen',lastName:'Worker'}}:strPath.endsWith('/active')?[objOrder]:{}};}};
 vm.createContext(objContext);vm.runInContext(strScript,objContext);await new Promise(fnResolve=>setImmediate(fnResolve));return {objContext,getElement,arrRequests,objOrder};
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
