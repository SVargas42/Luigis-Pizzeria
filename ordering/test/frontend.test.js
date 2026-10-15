import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

const strHtml=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const strScript=strHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
function createHarness(bFail=false) {
 const mapElements=new Map(),arrRequests=[];
 function createElement(){const setClasses=new Set();return {id:'',value:'',textContent:'',innerHTML:'',disabled:false,classList:{add(strName){setClasses.add(strName)},remove(strName){setClasses.delete(strName)},toggle(strName,bForce){const bAdd=bForce===undefined?!setClasses.has(strName):bForce;if(bAdd)setClasses.add(strName);else setClasses.delete(strName);return bAdd},contains(strName){return setClasses.has(strName)}},handlers:{},children:[],addEventListener(strType,fnHandler){this.handlers[strType]=fnHandler},querySelectorAll(){return []},querySelector(){return null},setAttribute(){},removeAttribute(){},focus(){},showModal(){this.open=true},close(){this.open=false;this.handlers.close?.()},checkValidity(){return true},reset(){},after(){},append(...arrChildren){this.children.push(...arrChildren)},replaceChildren(){this.children=[]}}}
 for(const strId of ['step-1','step-2','step-3','step-4']){const objElement=createElement();objElement.id=strId;mapElements.set(strId,objElement);}
 const mapWindowListeners=new Map();
 const objStorage=new Map();const objContext={document:{getElementById(strId){if(!mapElements.has(strId)){const objElement=createElement();objElement.id=strId;mapElements.set(strId,objElement)}return mapElements.get(strId)},querySelectorAll(strSelector){return strSelector==='[id^="step-"]'?[...mapElements.values()].filter(objElement=>objElement.id.startsWith('step-')):[]},querySelector(){return null},createElement},window:{scrollTo(){},matchMedia(){return {matches:true}},addEventListener(strType,fnListener){mapWindowListeners.set(strType,fnListener)},dispatchEvent(objEvent){mapWindowListeners.get(objEvent.type)?.(objEvent)}},CustomEvent:class{constructor(strType,objInit){this.type=strType;this.detail=objInit?.detail}},history:{replaceState(){}},location:{pathname:'/',search:'',href:'',assign(){}},sessionStorage:{setItem(k,v){objStorage.set(k,v)},getItem(k){return objStorage.get(k)||null},removeItem(k){objStorage.delete(k)}},URLSearchParams,crypto:{randomUUID},fetch:async(strPath,objOptions)=>{
  if(strPath==='/api/menu')return {ok:true,json:async()=>[{category:'pizza',name:'Small',price_cents:1000},{category:'topping',name:'Cheese',price_cents:150},{category:'topping',name:'Pepperoni',price_cents:200}]};
  if(strPath==='/api/session')return {ok:true,json:async()=>({authenticated:false,authReady:false,user:null})};
  if(strPath==='/api/orders/mine')return {ok:true,json:async()=>[]};
  arrRequests.push(JSON.parse(objOptions.body));
  return {ok:!bFail,json:async()=>bFail?{error:'Checkout unavailable'}:{url:'https://checkout.stripe.com/session'}};
 }};
 vm.createContext(objContext);vm.runInContext(strScript,objContext);
 return {mapElements,arrRequests,objContext};
}
test('admin homepage analytics link opens its separate analytics page',()=>{
 assert.match(strHtml,/id="admin-analytics-link"[^>]+href="\/admin\/analytics\?demo=1&tab=ordering"/);
});
test('customer selections are sent to hosted online checkout',async()=>{
 const objHarness=createHarness();
 for(const [strId,strValue] of [['firstName','Ada'],['lastName','Lovelace'],['email','ada@example.com'],['phone','1234567890']])objHarness.mapElements.get(strId).value=strValue;
 objHarness.mapElements.get('customer-form').handlers.submit({preventDefault(){}});
 vm.runInContext("state.pizzas[0].size='Small';goTo(3)",objHarness.objContext);
 await objHarness.mapElements.get('payment-form').handlers.submit({preventDefault(){}});
 assert.equal(objHarness.arrRequests[0].customer.email,'ada@example.com');
 assert.equal(objHarness.arrRequests[0].pizzas[0].size,'Small');
 assert.equal(vm.runInContext('state.step',objHarness.objContext),1);
 assert.equal(vm.runInContext('state.step',objHarness.objContext),1);
 assert.equal(/cardNumber|cvv|expiry/.test(JSON.stringify(objHarness.arrRequests[0])),false);
});
test('failed submissions show an error and reuse the retry key',async()=>{
 const objHarness=createHarness(true);
 await objHarness.mapElements.get('payment-form').handlers.submit({preventDefault(){}});
 await objHarness.mapElements.get('payment-form').handlers.submit({preventDefault(){}});
 assert.equal(objHarness.mapElements.get('order-error').textContent,'Checkout unavailable');
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
test('signed-in customer skips the guest details step and receives the Orders entry',()=>{
 const objHarness=createHarness();
 objHarness.objContext.window.LuigiPizzeriaIntegration.acceptAuthState({authenticated:true,authReady:true,user:{id:'customer-7',role:'customer',email:'ada@example.com',firstName:'Ada',lastName:'Lovelace',phone:''}});
 objHarness.mapElements.get('start-order').handlers.click();
 assert.equal(vm.runInContext('state.step',objHarness.objContext),2);
 assert.equal(objHarness.mapElements.get('firstName').value,'Ada');
 assert.equal(objHarness.mapElements.get('email').value,'ada@example.com');
 assert.equal(objHarness.mapElements.get('step-1').classList.contains('hidden'),true);
 assert.equal(objHarness.mapElements.get('orders-button').classList.contains('hidden'),false);
 assert.equal(objHarness.mapElements.get('start-order').textContent,'Place an Order →');
});
test('guest checkout keeps its details step and account requests do not authenticate a visitor',()=>{
 const objHarness=createHarness();
 objHarness.mapElements.get('start-order').textContent='Continue as Guest →';
 objHarness.mapElements.get('sign-in').handlers.click();
 assert.equal(vm.runInContext('objAuthState.user',objHarness.objContext),null);
 assert.match(objHarness.mapElements.get('auth-message').textContent,/choose an account type/i);
 objHarness.mapElements.get('start-order').handlers.click();
 assert.equal(vm.runInContext('state.step',objHarness.objContext),1);
 assert.equal(objHarness.mapElements.get('start-order').textContent,'Continue as Guest →');
 assert.equal(objHarness.mapElements.get('step-1').classList.contains('hidden'),false);
});
test('demo role picker exposes Customer and Admin UI without granting server access',()=>{
 const objHarness=createHarness();
 objHarness.mapElements.get('sign-in').handlers.click();
 assert.equal(objHarness.mapElements.get('demo-sign-in').open,true);
 objHarness.mapElements.get('demo-role').value='customer';
 objHarness.mapElements.get('demo-role-continue').handlers.click({preventDefault(){}});
 assert.equal(vm.runInContext('objAuthState.user.role',objHarness.objContext),'customer');
 assert.equal(vm.runInContext('objAuthState.demo',objHarness.objContext),true);
 assert.equal(objHarness.mapElements.get('orders-button').classList.contains('hidden'),false);
 assert.equal(objHarness.mapElements.get('firstName').value,'Alex');
 assert.doesNotMatch(objHarness.mapElements.get('auth-message').textContent,/demo|server data stays protected/i);
});
test('sign out clears the active role, returns home, and offers sign-in again',()=>{
 const objHarness=createHarness();
 vm.runInContext("selectDemoRole('admin')",objHarness.objContext);
 assert.equal(objHarness.mapElements.get('sign-out').classList.contains('hidden'),false);
 objHarness.mapElements.get('sign-out').handlers.click();
 assert.equal(vm.runInContext('objAuthState.user',objHarness.objContext),null);
 assert.equal(objHarness.mapElements.get('sign-out').classList.contains('hidden'),true);
 assert.equal(objHarness.mapElements.get('sign-in').classList.contains('hidden'),false);
 assert.equal(objHarness.mapElements.get('home-page').classList.contains('hidden'),false);
 assert.match(objHarness.mapElements.get('auth-message').textContent,/signed out/i);
});
test('selected role does not bypass hosted payment or create an unpaid order',async()=>{
 const objHarness=createHarness();
 vm.runInContext("selectDemoRole('customer')",objHarness.objContext);
 vm.runInContext("state.pizzas[0].size='Small';goTo(3)",objHarness.objContext);
 await objHarness.mapElements.get('payment-form').handlers.submit({preventDefault(){}});
 assert.equal(objHarness.arrRequests.length,1);
 assert.equal(objHarness.arrRequests[0].customer.email,'customer@luigispizza.com');
 assert.equal(vm.runInContext('state.step',objHarness.objContext),1);
});
