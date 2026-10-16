import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const strHtml=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
const strScript=strHtml.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];

test('staff screen script parses and includes all requested workspace tabs',()=>{
 assert.ok(strScript);
 new vm.Script(strScript.replace(/^ *import .*;\r?\n/gm,'').trim());
 for(const strTab of ['Current Orders','Past Orders','Ordering Analytics','Employee Data','Business Data','Customers'])assert.ok(strHtml.includes(strTab));
 assert.ok(strHtml.includes('aria-selected="true"'));
 assert.ok(!/synthetic|sample data only|school project/i.test(strHtml));
 assert.ok(strScript.includes("get('demo')==='1'"));
 assert.ok(strScript.includes('handleDemoAdminRequest'));
 assert.ok(strHtml.includes('href="/admin/analytics?demo=1&tab=ordering"'));
 assert.ok(strHtml.includes('id="edit-items-editor"'));
 assert.ok(!strHtml.includes('id="edit-items"'));
 assert.ok(!strHtml.includes('Accessible comparison values'));
 assert.ok(!strHtml.includes('data table'));
 assert.ok(strScript.includes("setAttribute('role','img')"));
});

test('staff lifecycle controls submit sequential status, UTC estimate and archive requests',async()=>{
 const mapElements=new Map(),arrRequests=[];
 const objOrder={id:7,status:'received',tracking_status:'order_received',customer_name:'Ada',customer_email:'ada@example.com',customer_phone:'5551234567',total_cents:1000,created_at:'2026-10-16T20:00:00Z',updated_at:'2026-10-16T20:00:00Z',items:[],payment_method:'in_store',payment_status:'unpaid'};
 function createElement(){return {children:[],handlers:{},dataset:{},classList:{toggle(){}},append(...arrChildren){this.children.push(...arrChildren);},prepend(objChild){this.children.unshift(objChild);},replaceChildren(){this.children=[];},setAttribute(){},addEventListener(strEvent,fnHandler){this.handlers[strEvent]=fnHandler;},focus(){},contains(){return false;},querySelector(){return null;}};}
 function getElement(strId){if(!mapElements.has(strId)){const objElement=createElement();objElement.id=strId;if(strId.startsWith('tab-'))objElement.dataset.panel=strId.slice(4);mapElements.set(strId,objElement);}return mapElements.get(strId);}
 const objContext={document:{getElementById:getElement,createElement,querySelectorAll(){return [];}},location:{search:'',pathname:'/admin'},URLSearchParams,setInterval(){},fetch:async(strPath,objOptions={})=>{
  if(strPath==='/api/menu')return {ok:true,json:async()=>[]};
  if(objOptions.method){arrRequests.push({strPath,...objOptions});return {ok:true,json:async()=>({})};}
  return {ok:true,json:async()=>strPath.includes('active')?[objOrder]:[]};
 }};
 vm.createContext(objContext);vm.runInContext(strScript.replace(/^ *import .*;\r?\n/gm,''),objContext);
 await new Promise(fnResolve=>setImmediate(fnResolve));
 const objCard=getElement('current-orders').children[0];
 const objForm=objCard.children.find(objChild=>objChild.handlers.submit);
 objForm.children[1].value='2026-10-20T14:30';
 await objForm.handlers.submit({preventDefault(){}});
 assert.equal(arrRequests[0].strPath,'/api/employee/orders/7/estimate');
 assert.equal(JSON.parse(arrRequests[0].body).estimatedPickupTime,new Date('2026-10-20T14:30').toISOString());
 const objActions=objCard.children.at(-1);assert.equal(objActions.children.length,1);
 objActions.children[0].handlers.click();await new Promise(fnResolve=>setImmediate(fnResolve));
 assert.equal(arrRequests[1].strPath,'/api/employee/orders/7/status');
 assert.deepEqual(JSON.parse(arrRequests[1].body),{status:'order_confirmed',expectedStatus:'order_received'});
 objOrder.status='ready';objOrder.tracking_status='order_ready';objContext.objReadyOrder=objOrder;
 const objReadyCard=vm.runInContext("renderOrder(objReadyOrder,'current')",objContext);
 objReadyCard.children.at(-1).children[0].handlers.click();await new Promise(fnResolve=>setImmediate(fnResolve));
 assert.equal(arrRequests[2].strPath,'/api/employee/orders/7/complete');assert.equal(arrRequests[2].method,'POST');
});
