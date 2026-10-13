import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

const strHtml=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const strScript=strHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
function createHarness(bFail=false) {
 const mapElements=new Map(),arrRequests=[];
 function createElement(){return {value:'',textContent:'',innerHTML:'',disabled:false,classList:{add(){},remove(){},toggle(){},contains(){return false}},handlers:{},children:[],addEventListener(strType,fnHandler){this.handlers[strType]=fnHandler},querySelectorAll(){return []},querySelector(){return null},setAttribute(){},removeAttribute(){},focus(){},checkValidity(){return true},reset(){},after(){},append(...arrChildren){this.children.push(...arrChildren)},replaceChildren(){this.children=[]}}}
 const objContext={document:{getElementById(strId){if(!mapElements.has(strId))mapElements.set(strId,createElement());return mapElements.get(strId)},querySelectorAll(){return []},querySelector(){return null},createElement},window:{scrollTo(){},matchMedia(){return {matches:true}}},history:{replaceState(){}},location:{pathname:'/',search:''},crypto:{randomUUID},fetch:async(strPath,objOptions)=>{
  if(strPath==='/api/menu')return {ok:true,json:async()=>[{category:'pizza',name:'Small',price_cents:1000},{category:'topping',name:'Cheese',price_cents:150},{category:'topping',name:'Pepperoni',price_cents:200}]};
  arrRequests.push(JSON.parse(objOptions.body));
  return {ok:!bFail,json:async()=>bFail?{error:'Database unavailable'}:{orderNumber:'LP-42',totalCents:1000,items:[{description:'Small pizza',quantity:1,unit:1000}]}};
 }};
 vm.createContext(objContext);vm.runInContext(strScript,objContext);
 return {mapElements,arrRequests,objContext};
}
test('customer selections reach API and confirmation uses saved database receipt',async()=>{
 const objHarness=createHarness();
 for(const [strId,strValue] of [['firstName','Ada'],['lastName','Lovelace'],['email','ada@example.com'],['phone','1234567890']])objHarness.mapElements.get(strId).value=strValue;
 objHarness.mapElements.get('customer-form').handlers.submit({preventDefault(){}});
 vm.runInContext("state.pizzas[0].size='Small'",objHarness.objContext);
 await objHarness.mapElements.get('payment-form').handlers.submit({preventDefault(){}});
 assert.equal(objHarness.arrRequests[0].customer.email,'ada@example.com');
 assert.equal(objHarness.arrRequests[0].pizzas[0].size,'Small');
 assert.equal(objHarness.mapElements.get('order-number').textContent,'LP-42');
 assert.equal(objHarness.mapElements.get('receipt-total').textContent,'$10.00');
 assert.equal(vm.runInContext('state.step',objHarness.objContext),4);
 assert.equal(/cardNumber|cvv|expiry/.test(JSON.stringify(objHarness.arrRequests[0])),false);
});
test('failed submissions show an error and reuse the retry key',async()=>{
 const objHarness=createHarness(true);
 await objHarness.mapElements.get('payment-form').handlers.submit({preventDefault(){}});
 await objHarness.mapElements.get('payment-form').handlers.submit({preventDefault(){}});
 assert.equal(objHarness.mapElements.get('order-error').textContent,'Database unavailable');
 assert.equal(objHarness.mapElements.get('place-order').disabled,false);
 assert.equal(objHarness.arrRequests[0].requestKey,objHarness.arrRequests[1].requestKey);
 assert.equal(vm.runInContext('state.step',objHarness.objContext),1);
});
test('menu topping labels and totals follow individual database prices',async()=>{
 const objHarness=createHarness();
 await new Promise(fnResolve=>setImmediate(fnResolve));
 vm.runInContext("state.pizzas[0].size='Small';state.pizzas[0].toppings=['Cheese','Pepperoni'];renderAll()",objHarness.objContext);
 assert.equal(objHarness.mapElements.get('menu-total').textContent,'$13.50');
 assert.ok(objHarness.mapElements.get('pizzas-container').innerHTML.includes('+$2.00'));
 assert.ok(objHarness.mapElements.get('pizzas-container').innerHTML.includes('+$1.50'));
});
