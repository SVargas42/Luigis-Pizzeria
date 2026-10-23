import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';

const strHtml=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const strScript=strHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
function createHarness(bFail=false,arrMenuRows=[{category:'pizza',name:'Small',price_cents:1000},{category:'topping',name:'Cheese',price_cents:150},{category:'topping',name:'Pepperoni',price_cents:200}]) {
 const mapElements=new Map(),arrRequests=[];
 function createElement(){const setClasses=new Set();return {id:'',value:'',textContent:'',innerHTML:'',disabled:false,classList:{add(strName){setClasses.add(strName)},remove(strName){setClasses.delete(strName)},toggle(strName,bForce){const bAdd=bForce===undefined?!setClasses.has(strName):bForce;if(bAdd)setClasses.add(strName);else setClasses.delete(strName);return bAdd},contains(strName){return setClasses.has(strName)}},handlers:{},children:[],addEventListener(strType,fnHandler){this.handlers[strType]=fnHandler},querySelectorAll(){return []},querySelector(){return null},setAttribute(){},removeAttribute(){},focus(){},showModal(){this.open=true},close(){this.open=false;this.handlers.close?.()},checkValidity(){return true},reset(){},after(){},append(...arrChildren){this.children.push(...arrChildren)},replaceChildren(){this.children=[]}}}
 for(const strId of ['step-1','step-2','step-3','step-4']){const objElement=createElement();objElement.id=strId;mapElements.set(strId,objElement);}
 const mapWindowListeners=new Map();
 const objStorage=new Map();const objContext={document:{getElementById(strId){if(!mapElements.has(strId)){const objElement=createElement();objElement.id=strId;mapElements.set(strId,objElement)}return mapElements.get(strId)},querySelectorAll(strSelector){return strSelector==='[id^="step-"]'?[...mapElements.values()].filter(objElement=>objElement.id.startsWith('step-')):[]},querySelector(){return null},createElement},window:{scrollTo(){},matchMedia(){return {matches:true}},addEventListener(strType,fnListener){mapWindowListeners.set(strType,fnListener)},dispatchEvent(objEvent){mapWindowListeners.get(objEvent.type)?.(objEvent)}},CustomEvent:class{constructor(strType,objInit){this.type=strType;this.detail=objInit?.detail}},history:{replaceState(){}},location:{pathname:'/',search:'',href:'',assign(strUrl){this.href=strUrl}},sessionStorage:{setItem(k,v){objStorage.set(k,v)},getItem(k){return objStorage.get(k)||null},removeItem(k){objStorage.delete(k)}},URLSearchParams,crypto:{randomUUID},fetch:async(strPath,objOptions)=>{
  if(strPath==='/api/menu')return {ok:true,json:async()=>arrMenuRows};
  if(strPath==='/api/payment/config')return {ok:true,json:async()=>({publishableKey:'pk_test_sample'})};
  if(strPath==='/api/session')return {ok:true,json:async()=>({authenticated:false,authReady:false,user:null})};
  if(strPath==='/api/auth/logout')return {ok:true,json:async()=>({message:'Signed out.'})};
  if(strPath==='/api/orders/mine')return {ok:true,json:async()=>[]};
  arrRequests.push(JSON.parse(objOptions.body));
  if(strPath==='/api/payment/intent')return {ok:!bFail,json:async()=>bFail?{error:'Checkout unavailable'}:{clientSecret:'pi_secret_sample'}};
  return {ok:!bFail,json:async()=>bFail?{error:'Checkout unavailable'}:{orderNumber:'LP-12',subtotalCents:1000,taxCents:0,totalCents:1000,paymentMethod:'in_store',paymentStatus:'unpaid',trackerUrl:'/track?token=abc',items:[{description:'Small Pizza',quantity:1,unit:1000}]}};
 },Stripe(){return {elements(){return {create(){return {mount(){}}}}},confirmCardPayment:async()=>({paymentIntent:{id:'pi_sample'}})}}};
 vm.createContext(objContext);vm.runInContext(strScript,objContext);
 for(const [strId,strValue] of [['firstName','Ada'],['lastName','Lovelace'],['email','ada@example.com'],['phone','5551234567'],['payment-method','in_store']])objContext.document.getElementById(strId).value=strValue;
 return {mapElements,arrRequests,objContext};
}
test('custom categories do not block supported menu items or pickup checkout',async()=>{
 const objHarness=createHarness(false,[
  {category:'dessert',name:'Brownie',price_cents:400},
  {category:'pizza',name:'Small',price_cents:1100},
  {category:'topping',name:'Cheese',price_cents:175},
  {category:'side',name:'Garlic Roll',price_cents:300},
  {category:'drink',name:'Large',price_cents:350},
  {category:'drink_name',name:'Water',price_cents:0}
 ]);
 await new Promise(fnResolve=>setImmediate(fnResolve));
 assert.equal(objHarness.mapElements.get('start-order').disabled,false);
 assert.equal(vm.runInContext('prices.pizza.Small',objHarness.objContext),11);
 assert.equal(vm.runInContext('objToppingPrices.Cheese',objHarness.objContext),1.75);
 assert.equal(vm.runInContext("prices.sides['Garlic Roll']",objHarness.objContext),3);
 assert.equal(vm.runInContext('prices.drinks.Large',objHarness.objContext),3.5);
 assert.equal(vm.runInContext('prices.beverages.Water',objHarness.objContext),0);
 assert.ok(objHarness.mapElements.get('sides-list').innerHTML.includes('Garlic Roll'));
 assert.ok(!objHarness.mapElements.get('sides-list').innerHTML.includes('Brownie'));
 vm.runInContext("state.pizzas[0].size='Small'",objHarness.objContext);
 await objHarness.mapElements.get('payment-form').handlers.submit({preventDefault(){}});
 assert.equal(objHarness.arrRequests[0].pizzas[0].size,'Small');
 assert.equal(vm.runInContext('state.step',objHarness.objContext),4);
});

test('unsupported category names cannot resolve inherited object properties',async()=>{
 const objHarness=createHarness(false,[
  ...['constructor','toString','__proto__'].map(strCategory=>({category:strCategory,name:'Unknown',price_cents:400})),
  {category:'pizza',name:'Small',price_cents:1000}
 ]);
 await new Promise(fnResolve=>setImmediate(fnResolve));
 assert.equal(objHarness.mapElements.get('start-order').disabled,false);
 assert.equal(vm.runInContext('prices.pizza.Small',objHarness.objContext),10);
 assert.equal(vm.runInContext('Object.hasOwn(prices,"undefined")',objHarness.objContext),false);
});

test('admin homepage analytics link opens its separate analytics page',()=>{
 assert.match(strHtml,/id="admin-analytics-link"[^>]+href="\/admin\/analytics\?tab=ordering"/);
});

test('worker Orders navigation opens the kitchen queue without revealing admin analytics',()=>{
 const objHarness=createHarness();
 vm.runInContext("setAuthState({authenticated:true,authReady:true,user:{id:'7',role:'worker',firstName:'Kitchen',lastName:'Worker',email:'worker@example.com',phone:'(555) 123-4567'}});showOrders();",objHarness.objContext);
 assert.equal(objHarness.objContext.location.href,'/staff');
 assert.equal(objHarness.mapElements.get('admin-analytics-link').classList.contains('hidden'),true);
});

test('checkout submits multiple distinct side selections as separate numeric quantities',async()=>{
 const objHarness=createHarness();
 vm.runInContext("state.pizzas[0].size='Small';state.sides=[{name:'Breadsticks',quantity:2},{name:'Pizza Stick',quantity:1}];",objHarness.objContext);
 await objHarness.mapElements.get('payment-form').handlers.submit({preventDefault(){}});
 assert.deepEqual(objHarness.arrRequests[0].sides,[{name:'Breadsticks',quantity:2},{name:'Pizza Stick',quantity:1}]);
});

test('cancelled customer order history overrides its former preparation stage',()=>{
 const objHarness=createHarness();
 vm.runInContext("renderCustomerOrders([{id:7,status:'cancelled',tracking_status:'cooking_order',total_cents:1000,created_at:'2026-10-21T12:00:00Z',items:[]}])",objHarness.objContext);
 const objCard=objHarness.mapElements.get('customer-orders-list').children[0];
 assert.ok(objCard.children.some(objChild=>objChild.textContent==='This order was cancelled.'));
});
test('guest details place email before the optional phone field',()=>{
 const nEmailPosition=strHtml.indexOf('for="email"'),nPhonePosition=strHtml.indexOf('for="phone"');
 assert.ok(nEmailPosition>=0&&nPhonePosition>nEmailPosition);
});
test('customer places pickup order and sees an itemized receipt and tracker',async()=>{
 const objHarness=createHarness();
 for(const [strId,strValue] of [['firstName','Ada'],['lastName','Lovelace'],['email','ada@example.com'],['phone','1234567890']])objHarness.mapElements.get(strId).value=strValue;
 objHarness.mapElements.get('customer-form').handlers.submit({preventDefault(){}});
 vm.runInContext("state.pizzas[0].size='Small';goTo(3)",objHarness.objContext);
 await objHarness.mapElements.get('payment-form').handlers.submit({preventDefault(){}});

 assert.equal(objHarness.arrRequests[0].customer.email,'ada@example.com');
 assert.equal(objHarness.arrRequests[0].pizzas[0].size,'Small');
 assert.equal(objHarness.arrRequests[0].paymentMethod,'in_store');
 assert.equal(objHarness.mapElements.get('receipt-tracker').href,'/track?token=abc');
 assert.equal(vm.runInContext('state.step',objHarness.objContext),4);
 assert.equal(objHarness.mapElements.get('order-number').textContent,'LP-12');
 assert.equal(/cardNumber|cvv|expiry/.test(JSON.stringify(objHarness.arrRequests[0])),false);
});
test('every Breadsticks size can reach Stripe checkout with its selected size',async()=>{
 for(const strSize of ['Small','Medium','Large']){
  const objHarness=createHarness();let objSubmitted;
  objHarness.objContext.beginStripeCheckout=async objPayload=>{objSubmitted=JSON.parse(JSON.stringify(objPayload));};
  vm.runInContext(`state.pizzas[0].size='Small';state.sides=[{name:'Breadsticks',size:'${strSize}',quantity:2}];`,objHarness.objContext);
  objHarness.mapElements.get('payment-method').value='online';
  await objHarness.mapElements.get('payment-form').handlers.submit({preventDefault(){}});
  assert.equal(objSubmitted.sides[0].size,strSize);assert.equal(objSubmitted.sides[0].quantity,2);
  assert.equal(objHarness.arrRequests.length,0);
 }
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
 objHarness.objContext.window.LuigiPizzeriaIntegration.acceptAuthState({authenticated:true,authReady:true,user:{id:'customer-7',role:'customer',email:'ada@example.com',firstName:'Ada',lastName:'Lovelace',phone:'5551234567'}});
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
 assert.equal(objHarness.objContext.location.href,'/account?mode=login');
 objHarness.mapElements.get('start-order').handlers.click();
 assert.equal(vm.runInContext('state.step',objHarness.objContext),1);
 assert.equal(objHarness.mapElements.get('start-order').textContent,'Continue as Guest →');
 assert.equal(objHarness.mapElements.get('step-1').classList.contains('hidden'),false);
});
test('account access uses the real sign-in page and has no role selector',()=>{const objHarness=createHarness();objHarness.mapElements.get('create-account').handlers.click();assert.equal(objHarness.objContext.location.href,'/account?mode=register');assert.doesNotMatch(strHtml,/id="demo-role"/);assert.equal(vm.runInContext('objAuthState.user',objHarness.objContext),null);});
test('sign out clears the active role, returns home, and offers sign-in again',async()=>{
 const objHarness=createHarness();
 objHarness.objContext.window.LuigiPizzeriaIntegration.acceptAuthState({authenticated:true,authReady:true,user:{id:'7',role:'admin',email:'admin@example.com',firstName:'Ada',lastName:'Admin',phone:'5551234567'}});
 assert.equal(objHarness.mapElements.get('sign-out').classList.contains('hidden'),false);
 await objHarness.mapElements.get('sign-out').handlers.click();
 assert.equal(vm.runInContext('objAuthState.user',objHarness.objContext),null);
 assert.equal(objHarness.mapElements.get('sign-out').classList.contains('hidden'),true);
 assert.equal(objHarness.mapElements.get('sign-in').classList.contains('hidden'),false);
 assert.equal(objHarness.mapElements.get('home-page').classList.contains('hidden'),false);
 assert.match(objHarness.mapElements.get('auth-message').textContent,/guest/i);
});
test('signed-in customer submits pickup order without collecting card details',async()=>{
 const objHarness=createHarness();
 objHarness.objContext.window.LuigiPizzeriaIntegration.acceptAuthState({authenticated:true,authReady:true,user:{id:'8',role:'customer',email:'customer@example.com',firstName:'Ada',lastName:'Customer',phone:'5551234567'}});
 objHarness.mapElements.get('phone').value='5551234567';objHarness.mapElements.get('payment-method').value='in_store';
 vm.runInContext("state.pizzas[0].size='Small';goTo(3)",objHarness.objContext);
 await objHarness.mapElements.get('payment-form').handlers.submit({preventDefault(){}});
 assert.equal(objHarness.arrRequests.length,1);
 assert.equal(objHarness.arrRequests[0].customer.email,'customer@example.com');
 assert.equal(objHarness.arrRequests[0].paymentMethod,'in_store');
 assert.equal(vm.runInContext('state.step',objHarness.objContext),4);
});


test('signed-in account without phone can enter the required contact details',()=>{
 const objHarness=createHarness();
 objHarness.objContext.window.LuigiPizzeriaIntegration.acceptAuthState({authenticated:true,authReady:true,user:{id:'customer-8',role:'customer',email:'ada@example.com',firstName:'Ada',lastName:'Lovelace',phone:''}});
 objHarness.mapElements.get('start-order').handlers.click();
 assert.equal(vm.runInContext('state.step',objHarness.objContext),1);
 assert.equal(objHarness.mapElements.get('step-1').classList.contains('hidden'),false);
});


test('admin Orders navigation opens the authenticated live queue',()=>{
 const objHarness=createHarness();
 objHarness.objContext.window.LuigiPizzeriaIntegration.acceptAuthState({authenticated:true,authReady:true,user:{id:'7',role:'admin',email:'admin@example.com',firstName:'Ada',lastName:'Admin',phone:'5551234567'}});
 objHarness.mapElements.get('orders-button').handlers.click();
 assert.equal(objHarness.objContext.location.href,'/admin?tab=current');
});

const strStripeCode=readFileSync(new URL('../public/stripe-checkout.js',import.meta.url),'utf8');
test('card checkout redirects to Stripe and retries with the same secret, without posting an unpaid order',async()=>{
 const objHarness=createHarness(),fnOriginal=objHarness.objContext.fetch,arrStripeRequests=[];objHarness.objContext.URL=URL;
 objHarness.objContext.fetch=async(strPath,objOptions)=>{if(strPath==='/api/stripe/config')return {ok:true,json:async()=>({enabled:true})};if(strPath==='/api/stripe/checkout'){arrStripeRequests.push(JSON.parse(objOptions.body));return {ok:true,json:async()=>({state:'open',url:'https://checkout.stripe.com/c/pay/cs_test_example'})};}return fnOriginal(strPath,objOptions);};
 vm.runInContext(strStripeCode,objHarness.objContext);await new Promise(fnResolve=>setImmediate(fnResolve));
 objHarness.mapElements.get('customer-form').handlers.submit({preventDefault(){}});objHarness.mapElements.get('payment-method').value='online';
 vm.runInContext("state.pizzas[0].size='Small';goTo(3)",objHarness.objContext);
 await objHarness.mapElements.get('payment-form').handlers.submit({preventDefault(){}});await objHarness.mapElements.get('payment-form').handlers.submit({preventDefault(){}});
 assert.equal(arrStripeRequests.length,2);assert.equal(arrStripeRequests[0].checkoutToken,arrStripeRequests[1].checkoutToken);assert.match(arrStripeRequests[0].checkoutToken,/^[a-f0-9]{64}$/);assert.equal(objHarness.arrRequests.length,0);assert.equal(objHarness.objContext.location.href,'https://checkout.stripe.com/c/pay/cs_test_example');assert.notEqual(vm.runInContext('state.step',objHarness.objContext),4);
});
test('return-page URL alone cannot produce a paid receipt',async()=>{
 const objHarness=createHarness(),fnOriginal=objHarness.objContext.fetch;objHarness.objContext.URL=URL;objHarness.objContext.location.search='?checkout=success&session_id=cs_test_forged';
 objHarness.objContext.fetch=async(strPath,objOptions)=>strPath==='/api/stripe/config'?{ok:true,json:async()=>({enabled:true})}:fnOriginal(strPath,objOptions);
 vm.runInContext(strStripeCode,objHarness.objContext);await new Promise(fnResolve=>setImmediate(fnResolve));assert.notEqual(vm.runInContext('state.step',objHarness.objContext),4);assert.match(vm.runInContext('objPaymentMessage.textContent',objHarness.objContext),/no checkout access token/i);
});
test('verified return displays the paid receipt, tracker and confirmation without submitting another order',async()=>{
 const objHarness=createHarness(),fnOriginal=objHarness.objContext.fetch;objHarness.objContext.URL=URL;objHarness.objContext.location.search='?checkout=success&session_id=cs_test_verified';
 objHarness.objContext.sessionStorage.setItem('luigiStripeCheckout',JSON.stringify({requestKey:'12345678-1234-4123-8123-123456789abc',checkoutToken:'a'.repeat(64)}));
 objHarness.objContext.fetch=async(strPath,objOptions)=>{
  if(strPath==='/api/stripe/config')return {ok:true,json:async()=>({enabled:true})};
  if(strPath==='/api/stripe/status')return {ok:true,json:async()=>({state:'paid',receipt:{orderNumber:'LP-99',customer:{name:'Ada Customer',email:'ada@example.com',phone:'5551234567'},items:[{description:'Small pizza',quantity:1,unit:1000}],subtotalCents:1000,taxCents:0,totalCents:1000,paymentMethod:'online',paymentStatus:'paid',trackerUrl:'/track?token=verified'}})};
  return fnOriginal(strPath,objOptions);
 };
 vm.runInContext(strStripeCode,objHarness.objContext);await new Promise(fnResolve=>setImmediate(fnResolve));assert.equal(vm.runInContext('state.step',objHarness.objContext),4);assert.equal(objHarness.mapElements.get('order-number').textContent,'LP-99');assert.equal(objHarness.mapElements.get('receipt-details').textContent,'Stripe · paid');assert.equal(objHarness.mapElements.get('receipt-tracker').href,'/track?token=verified');assert.equal(objHarness.objContext.sessionStorage.getItem('luigiStripeCheckout'),null);assert.equal(objHarness.arrRequests.length,0);
});
