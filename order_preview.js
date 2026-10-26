
    // Card details are collected on Stripe-hosted Checkout.
    let prices = {pizza:{Small:10,Medium:13,Large:16},topping:1.5,sides:{None:0,Breadsticks:5,'Pizza Bites':6},drinks:{Small:2,Medium:2.75,Large:3.5},beverages:{Coke:0,Pepsi:0,'Dr Pepper':0,Water:0}};
    let objToppingPrices = Object.fromEntries(['Cheese','Pepperoni','Sausage','Pineapple','Olives','Barbeque Chicken'].map(strName=>[strName,1.5]));
    let toppingChoices = ['Cheese','Pepperoni','Sausage','Pineapple','Olives','Barbeque Chicken'];
    let drinkChoices=['Coke','Pepsi','Dr Pepper','Water'];
    let nextPizzaId=1,nextDrinkId=1, requestKey=null, submitting=false;
    const state = {step:1,customer:{firstName:'',lastName:'',email:'',phone:''},pizzas:[{id:nextPizzaId++,size:null,toppings:[]}],activePizzaId:1,sides:[],drinks:[]};
    const objAuthState = {user:null,ready:false,demo:false};
    const $ = (id) => document.getElementById(id);
    const money = (n) => '$' + n.toFixed(2);

    function setAuthState(objSession,bDemo=false){
      const objUser=objSession?.user||objSession;
      const bAuthenticated=Boolean(objSession?.authenticated??(objUser?.email&&objUser?.role));
      objAuthState.user=bAuthenticated&&objUser&&['customer','worker','admin'].includes(objUser.role)?{
        id:objUser.id||objUser.email,email:String(objUser.email||''),firstName:String(objUser.firstName||''),lastName:String(objUser.lastName||''),phone:String(objUser.phone||''),role:objUser.role
      }:null;
      objAuthState.ready=Boolean(objSession?.authReady);
      objAuthState.demo=bDemo;
      if(objAuthState.user){
        state.customer={firstName:objAuthState.user.firstName,lastName:objAuthState.user.lastName,email:objAuthState.user.email,phone:objAuthState.user.phone};
        $('firstName').value=state.customer.firstName;$('lastName').value=state.customer.lastName;$('email').value=state.customer.email;$('phone').value=state.customer.phone;
        $('sign-in').classList.add('hidden');$('create-account').classList.add('hidden');$('account-name').classList.remove('hidden');$('account-name').textContent=`${state.customer.firstName} ${state.customer.lastName}`.trim()||state.customer.email;
        $('account-settings').classList.remove('hidden');
        $('orders-button').classList.remove('hidden');
        $('sign-out').classList.remove('hidden');
        $('admin-analytics-link').classList.toggle('hidden',objAuthState.user.role!=='admin');
        $('auth-message').textContent=objAuthState.user.role==='admin'?'Welcome back. Manage orders and business insights from your account.':'Welcome back. Your account details are ready for checkout.';
        $('start-order').textContent='Start your Order →';
        if(state.step===1&& !$('order-view').classList.contains('hidden'))goTo(2);
      }else{
        $('start-order').textContent='Start your Order →';
        $('sign-in').classList.remove('hidden');$('create-account').classList.remove('hidden');$('account-name').classList.add('hidden');$('account-settings').classList.add('hidden');$('orders-button').classList.add('hidden');$('admin-analytics-link').classList.add('hidden');$('sign-out').classList.add('hidden');
        if(state.step!==1&& !$('order-view').classList.contains('hidden'))goTo(1);
        $('auth-message').textContent='You can sign in or continue as a guest.';
      }
      updateProgress();
    }

    function requestAuthAction(strAction){location.assign('/account?mode='+encodeURIComponent(strAction==='create-account'?'register':strAction==='account-settings'?'profile':'login'));}
    async function signOut(){try{const objResponse=await fetch('/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!objResponse.ok)throw Error('Unable to sign out. Please retry.');state.customer={firstName:'',lastName:'',email:'',phone:''};setAuthState({authenticated:false,authReady:true});showHome();}catch(objError){$('auth-message').textContent=objError.message;}}
    window.addEventListener('luigi:auth-state',objEvent=>setAuthState(objEvent.detail));
    // Page state is informational; every protected API verifies the server session.
    window.LuigiPizzeriaIntegration={acceptAuthState:setAuthState};

    const nMaxPizzaCount=30;
    const getPizzaQuantity=objPizza=>objPizza.quantity??1;
    const getPizzaCount=()=>state.pizzas.reduce((nCount,objPizza)=>nCount+getPizzaQuantity(objPizza),0);
    function validatePizzaQuantities(bFocus=false){
      const bInvalid=state.pizzas.some(objPizza=>!Number.isInteger(getPizzaQuantity(objPizza))||getPizzaQuantity(objPizza)<1||getPizzaQuantity(objPizza)>nMaxPizzaCount)||getPizzaCount()>nMaxPizzaCount;
      if(bInvalid){$('menu-error').textContent='Enter whole pizza quantities from 1 to 30, with no more than 30 pizzas per order. For larger orders, call 931-372-3122.';if(bFocus)$('pizzas-container').querySelector('.pizza-quantity-input')?.focus();}
      return !bInvalid;
    }
    function checkoutPizzas(){
      if(!validatePizzaQuantities())throw Error('Check pizza quantities before placing your order.');
      // Preserve the existing API contract: one size/topping selection per physical pizza.
      return state.pizzas.flatMap(objPizza=>Array.from({length:getPizzaQuantity(objPizza)},()=>({size:objPizza.size,toppings:[...objPizza.toppings]})));
    }
    function renderPizzas(){
      const arrPizzaSizes=Object.keys(prices.pizza).sort((strLeft,strRight)=>{const arrStandard=['Small','Medium','Large'];const nLeft=arrStandard.indexOf(strLeft),nRight=arrStandard.indexOf(strRight);return (nLeft<0?arrStandard.length:nLeft)-(nRight<0?arrStandard.length:nRight)||strLeft.localeCompare(strRight);});
      $('pizzas-container').innerHTML=state.pizzas.map((pizza,index)=>{const open=state.activePizzaId===pizza.id;const detail=pizza.size?`${pizza.size} · ${pizza.toppings.length} topping${pizza.toppings.length===1?'':'s'}`:'Choose a size to get started';return `<article class="pizza-builder" data-pizza-id="${pizza.id}"><div class="d-flex justify-content-between align-items-center mb-2"><button class="pizza-heading flex-grow-1 toggle-pizza" type="button" data-id="${pizza.id}" aria-expanded="${open}" aria-controls="pizza-details-${pizza.id}"><span>Pizza ${index+1} <span class="pizza-chevron ms-1">${open?'▾':'▸'}</span></span><span class="pizza-subtitle">${detail}</span></button>${state.pizzas.length>1?`<button class="btn btn-sm btn-link text-danger p-0 ms-3 remove-pizza" type="button" data-id="${pizza.id}" aria-label="Remove pizza ${index+1}">Remove</button>`:''}</div><div id="pizza-details-${pizza.id}" class="pizza-details ${open?'':'hidden'}"><section class="card preview-choice-card mb-3" aria-labelledby="preview-size-${pizza.id}"><div class="card-header bg-light"><h4 class="h6 mb-0" id="preview-size-${pizza.id}">Size</h4></div><div class="card-body"><div class="option-grid pizza-size-options" role="radiogroup" aria-label="Pizza ${index+1} size">${arrPizzaSizes.map(size=>`<label class="option-tile ${pizza.size===size?'selected':''}"><input class="form-check-input" type="radio" name="pizza-size-${pizza.id}" value="${size}" ${pizza.size===size?'checked':''} aria-label="${size}"><span class="option-name">${size}</span><div class="option-price">${money(prices.pizza[size])}</div></label>`).join('')}</div></div></section><section class="card preview-choice-card" aria-labelledby="preview-toppings-${pizza.id}"><div class="card-header bg-light"><h4 class="h6 mb-0" id="preview-toppings-${pizza.id}">Toppings</h4><span class="small">Priced individually</span></div><div class="card-body"><div class="topping-grid">${toppingChoices.map(name=>`<label class="topping-option"><input class="form-check-input" type="checkbox" value="${name}" ${pizza.toppings.includes(name)?'checked':''}><span>${name}</span>${pizza.toppings.includes(name)?'<span class="preview-added" aria-hidden="true">✓ Added</span>':''}<span class="ms-auto text-secondary small">+${money(objToppingPrices[name])}</span></label>`).join('')}</div></div></section><div class="quantity-control mt-3"><label class="form-label" for="pizza-quantity-${pizza.id}">Quantity</label><input id="pizza-quantity-${pizza.id}" class="form-control pizza-quantity-input" type="number" min="1" max="30" step="1" inputmode="numeric" value="${getPizzaQuantity(pizza)}" aria-label="Quantity of pizza ${index+1}" required></div></div></article>`}).join('');
      $('pizzas-container').querySelectorAll('.toggle-pizza').forEach(button=>button.addEventListener('click',()=>{const id=Number(button.dataset.id);state.activePizzaId=state.activePizzaId===id?null:id;renderPizzas();document.querySelector(`[data-id="${id}"].toggle-pizza`)?.focus({preventScroll:true})}));
      $('pizzas-container').querySelectorAll('.pizza-builder').forEach(card=>{const pizza=state.pizzas.find(item=>item.id===Number(card.dataset.pizzaId));card.querySelectorAll('input[type="radio"]').forEach(input=>input.addEventListener('change',()=>{pizza.size=input.value;const id=pizza.id;renderAll();document.querySelector(`[data-pizza-id="${id}"] input[type="radio"]:checked`)?.focus({preventScroll:true})}));card.querySelectorAll('input[type="checkbox"]').forEach(input=>input.addEventListener('change',()=>{const name=input.value;pizza.toppings=input.checked?[...pizza.toppings,name]:pizza.toppings.filter(item=>item!==name);const id=pizza.id;renderAll();const newCard=document.querySelector(`[data-pizza-id="${id}"]`);[...newCard.querySelectorAll('input[type="checkbox"]')].find(item=>item.value===name)?.focus({preventScroll:true})}));});
      $('pizzas-container').querySelectorAll('.pizza-quantity-input').forEach(objInput=>objInput.addEventListener('input',()=>{
        const objPizza=state.pizzas.find(objItem=>`pizza-quantity-${objItem.id}`===objInput.id);objPizza.quantity=Number(objInput.value);
        $('menu-error').textContent='';validatePizzaQuantities();renderSummary();
      }));
      $('pizzas-container').querySelectorAll('.remove-pizza').forEach(button=>button.addEventListener('click',()=>{const removedId=Number(button.dataset.id);state.pizzas=state.pizzas.filter(pizza=>pizza.id!==removedId);if(state.activePizzaId===removedId)state.activePizzaId=state.pizzas[0]?.id??null;renderAll();document.querySelector('.toggle-pizza')?.focus({preventScroll:true})}));
    }
    function quantitySelect(value,label){return `<select class="form-select quantity-select" aria-label="Qty: ${label}">${Array.from({length:10},(_,i)=>`<option value="${i+1}" ${value===i+1?'selected':''}>${i+1}</option>`).join('')}</select>`}
    function quantityInput(value,label){return `<input class="form-control quantity-input side-quantity-input" type="number" min="1" max="99" step="1" inputmode="numeric" value="${value}" aria-label="Quantity of ${label}" required>`}
    function renderExtras(){
      $('sides-list').innerHTML=Object.entries(prices.sides).filter(([name])=>name!=='None').map(([name,price])=>{const chosen=state.sides.find(side=>side.name===name);return `<div class="extra-row"><label class="extra-choice"><input class="form-check-input side-check" type="checkbox" value="${name}" ${chosen?'checked':''}><span class="extra-name">${name}</span><span class="extra-price">${money(price)} each</span></label><div class="extra-quantity ${chosen?'':'hidden'}"><label class="side-quantity-label"><span>Quantity</span>${quantityInput(chosen?.quantity||1,name)}</label></div></div>`}).join('');
      $('drinks-list').innerHTML=state.drinks.map(drink=>`<div class="extra-row drink-config" data-drink-id="${drink.id}"><label class="extra-field"><span>Drink</span><select class="form-select drink-name-select" aria-label="Drink type"><option value="">Choose a drink</option>${drinkChoices.map(name=>`<option value="${name}" ${drink.name===name?'selected':''}>${name}</option>`).join('')}</select></label><label class="extra-field"><span>Size</span><select class="form-select drink-size-select" aria-label="${drink.name||'Drink'} size"><option value="">Choose a size</option>${Object.keys(prices.drinks).map(size=>`<option value="${size}" ${drink.size===size?'selected':''}>${size} · ${money(prices.drinks[size]+(prices.beverages[drink.name]||0))}</option>`).join('')}</select></label><label class="extra-field"><span>Qty</span>${quantitySelect(drink.quantity,`${drink.name||'Drink'} quantity`)}</label><button type="button" class="btn btn-sm btn-link text-danger drink-remove" aria-label="Remove ${drink.name||'drink'}">Remove</button></div>`).join('')||'<div class="empty-cart">No drinks added yet.</div>';
      $('sides-list').querySelectorAll('.side-check').forEach(objInput => {
        objInput.addEventListener('change', () => {
          const strName = objInput.value;
          if (objInput.checked) {
            state.sides.push({name: strName, quantity: 1});
          } else {
            state.sides = state.sides.filter(objSide => objSide.name !== strName);
          }
          renderAll();
          [...$('sides-list').querySelectorAll('.side-check')]
            .find(objCheckbox => objCheckbox.value === strName)
            ?.focus({preventScroll: true});
        });
      });
      $('sides-list').querySelectorAll('.side-quantity-input').forEach(input=>input.addEventListener('input',()=>{const side=state.sides.find(item=>input.getAttribute('aria-label')===`Quantity of ${item.name}`);if(side){side.quantity=Number(input.value);renderSummary()}}));
      $('drinks-list').querySelectorAll('.drink-config').forEach(row=>{const drink=state.drinks.find(item=>item.id===Number(row.dataset.drinkId));row.querySelector('.drink-name-select').addEventListener('change',event=>{const id=drink.id;drink.name=event.target.value;renderAll();document.querySelector(`[data-drink-id="${id}"] .drink-name-select`)?.focus({preventScroll:true})});row.querySelector('.drink-size-select').addEventListener('change',event=>{drink.size=event.target.value;renderSummary()});row.querySelector('.quantity-select').addEventListener('change',event=>{drink.quantity=Number(event.target.value);renderSummary()});row.querySelector('.drink-remove').addEventListener('click',()=>{state.drinks=state.drinks.filter(item=>item.id!==drink.id);renderAll();const next=$('drinks-list').querySelector('.drink-config .drink-name-select');(next||$('add-drink')).focus({preventScroll:true})})});
    }
    function lineItems(){
      const items=[];
      state.pizzas.forEach((pizza,index)=>{if(pizza.size){const toppings=pizza.toppings.length?` with ${pizza.toppings.map(name=>name.toLowerCase()).join(', ')}`:'';items.push({name:`Pizza ${index+1} ${pizza.size}${toppings} × ${getPizzaQuantity(pizza)}`,price:(prices.pizza[pizza.size]+pizza.toppings.reduce((nSum,strName)=>nSum+objToppingPrices[strName],0))*(Number.isInteger(getPizzaQuantity(pizza))&&getPizzaQuantity(pizza)>0&&getPizzaQuantity(pizza)<=nMaxPizzaCount?getPizzaQuantity(pizza):0)})}});
      state.sides.forEach(objSide => items.push({name:`${objSide.name} × ${objSide.quantity}`,price:prices.sides[objSide.name]*objSide.quantity}));
      state.drinks.filter(drink=>drink.name&&drink.size).forEach(drink=>items.push({name:`${drink.name} (${drink.size}) × ${drink.quantity}`,price:(prices.drinks[drink.size]+(prices.beverages[drink.name]||0))*drink.quantity}));
      return items;
    }
    function total(){return lineItems().reduce((sum,item)=>sum+item.price,0)}
    function summaryMarkup(){return lineItems().map(item=>`<div class="summary-line"><span class="line-name">${item.name}</span><span class="line-price">${money(item.price)}</span></div>`).join('')}
    function renderSummary(){$('add-pizza').disabled=getPizzaCount()>=nMaxPizzaCount;const markup=summaryMarkup()||'<div class="empty-cart">Choose a size for at least one pizza to begin.</div>';$('menu-summary-lines').innerHTML=markup;$('menu-total').textContent=money(total());$('payment-total').textContent=money(total());$('receipt-lines').innerHTML=summaryMarkup();$('receipt-total').textContent=money(total());$('receipt-details').textContent='';}
    function renderAll(){renderPizzas();renderExtras();renderSummary()}
    function scrollToPageTop(){window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})}
    function canSkipContactDetails(){return Boolean(objAuthState.user&&state.customer.firstName&&state.customer.lastName&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.customer.email)&&state.customer.phone.replace(/\D/g,'').length>=7);}
    function updateProgress(){
      const nTotalSteps=canSkipContactDetails()?3:4;
      document.querySelectorAll('[data-step-indicator]').forEach(el=>{
        const nStep=Number(el.dataset.stepIndicator),bHidden=Boolean(canSkipContactDetails())&&nStep===1;
        el.classList.toggle('hidden',bHidden);
        const nDisplay=canSkipContactDetails()?nStep-1:nStep;
        const bActive=nStep===state.step,bDone=nStep<state.step;
        el.classList.toggle('active',bActive);el.classList.toggle('done',bDone);
        if(bActive)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');
        const objDot=el.querySelector('.step-dot');if(objDot)objDot.textContent=bDone?'✓':nDisplay;
      });
      document.querySelectorAll('[data-step-label]').forEach(el=>{const nStep=Number(el.dataset.stepLabel),nDisplay=nStep-(canSkipContactDetails()?1:0);el.textContent=nStep===4?`Step ${nDisplay} of ${nTotalSteps} · Order confirmed`:`Step ${nDisplay} of ${nTotalSteps}`;});
      document.querySelectorAll('[data-step-heading]').forEach(el=>{const nStep=Number(el.dataset.stepHeading);el.textContent=`Step ${nStep-(canSkipContactDetails()?1:0)} of ${nTotalSteps}: `;});
    }
    function goTo(step){
      state.step=step;
      document.querySelectorAll('[id^="step-"]').forEach(el=>el.classList.toggle('hidden',el.id!==`step-${step}`));
      updateProgress();
      $(`${['','details-title','menu-title','payment-title','confirm-title'][step]}`).focus({preventScroll:true});scrollToPageTop();

    }

    function showHome(){ $('home-page').classList.remove('hidden');$('orders-portal').classList.add('hidden');$('order-view').classList.add('hidden');$('order-hero').classList.add('hidden');history.replaceState(null,'',location.pathname+location.search);$('home-title').focus({preventScroll:true});scrollToPageTop(); }
    function showOrders(){
      if(objAuthState.user?.role==='worker'){location.href='/staff';return;}if(objAuthState.user?.role==='admin'){location.href='/admin?tab=current';return;}
      $('home-page').classList.add('hidden');$('order-view').classList.add('hidden');$('order-hero').classList.add('hidden');$('orders-portal').classList.remove('hidden');$('customer-orders-panel').classList.add('hidden');$('customer-orders-error').textContent='';$('orders-title').focus({preventScroll:true});scrollToPageTop();
    }
    function startOrder(){ $('home-page').classList.add('hidden');$('orders-portal').classList.add('hidden');$('order-view').classList.remove('hidden');$('order-hero').classList.remove('hidden');goTo(canSkipContactDetails()?2:1);history.replaceState(null,'','#order'); }
    function renderCustomerOrders(arrOrders){
      const objList=$('customer-orders-list');objList.replaceChildren();
      if(!arrOrders.length){const objEmpty=document.createElement('p');objEmpty.className='empty-cart';objEmpty.textContent='No orders have been placed on this account yet.';objList.append(objEmpty);return;}
      const arrStatuses=['order_received','order_confirmed','preparing_order','cooking_order','order_ready','completed'];
      for(const objOrder of arrOrders){
        const objCard=document.createElement('article');objCard.className='customer-order';
        const objHeading=document.createElement('h3');objHeading.textContent=`Order LP-${objOrder.id} · ${money(objOrder.total_cents/100)}`;
        const strCurrentStatus=['completed','cancelled'].includes(objOrder.status)?objOrder.status:objOrder.tracking_status||objOrder.status;
        const objStatus=document.createElement('p');objStatus.textContent=strCurrentStatus==='cancelled'?'This order was cancelled.':`Current stage: ${{order_received:'Order received',order_confirmed:'Order confirmed',preparing_order:'Preparing',cooking_order:'Cooking',order_ready:'Ready for pickup',received:'Order received',preparing:'Preparing',ready:'Ready for pickup',completed:'Picked up'}[strCurrentStatus]||'Status unavailable'}.`;
        const objPlaced=document.createElement('p');const objPlacedDate=new Date(objOrder.created_at);objPlaced.textContent=`Placed ${Number.isNaN(objPlacedDate.getTime())?'at an unknown time':objPlacedDate.toLocaleString()}. Stage updates are posted by restaurant staff.`;
        const objTrack=document.createElement('ol');objTrack.className='status-track';objTrack.setAttribute('aria-label',`Order LP-${objOrder.id} progress`);
        const nCurrent=arrStatuses.indexOf(strCurrentStatus);
        for(let nIndex=0;nIndex<arrStatuses.length;nIndex++){
          const objStep=document.createElement('li');objStep.textContent={order_received:'Received',order_confirmed:'Confirmed',preparing_order:'Preparing',cooking_order:'Cooking',order_ready:'Ready for pickup',completed:'Picked up'}[arrStatuses[nIndex]];
          if(strCurrentStatus==='cancelled')objStep.classList.toggle('cancelled',nIndex===0);
          else if(nIndex<nCurrent)objStep.classList.add('past');
          else if(nIndex===nCurrent){objStep.classList.add('current');objStep.setAttribute('aria-current','step');}
          objTrack.append(objStep);
        }
        const objItems=document.createElement('ul');
        for(const objItem of objOrder.items||[]){const objItemLine=document.createElement('li');objItemLine.textContent=`${objItem.quantity} × ${objItem.description}`;objItems.append(objItemLine);}
        if(objOrder.payment_status){const objPayment=document.createElement('p');objPayment.textContent='Payment: '+objOrder.payment_status+(objOrder.refunded_cents?' · Refunded '+money(objOrder.refunded_cents/100):'');objCard.append(objPayment);}
        objCard.append(objHeading,objStatus,objPlaced,objTrack,objItems);objList.append(objCard);
      }
    }
    async function loadCustomerOrders(){
      $('customer-orders-panel').classList.remove('hidden');$('customer-orders-error').textContent='Loading your orders…';$('customer-orders-list').replaceChildren();
      try{const objResponse=await fetch('/api/orders/mine');const arrOrders=await objResponse.json();if(!objResponse.ok)throw Error(arrOrders.error||'Unable to load orders.');renderCustomerOrders(arrOrders);$('customer-orders-error').textContent='';}
      catch(error){$('customer-orders-error').textContent=error.message||'Unable to load orders.';}
    }
    function setInvalid(input,invalid){input.classList.toggle('is-invalid',invalid);input.setAttribute('aria-invalid',String(invalid));}
    function normalizePhone(strValue){let strDigits=strValue.replace(/\D/g,'');if(strDigits.length===11&&strDigits.startsWith('1'))strDigits=strDigits.slice(1);strDigits=strDigits.slice(0,10);if(!strDigits)return '';if(strDigits.length<=3)return `(${strDigits}`;if(strDigits.length<=6)return `(${strDigits.slice(0,3)}) ${strDigits.slice(3)}`;return `(${strDigits.slice(0,3)}) ${strDigits.slice(3,6)}-${strDigits.slice(6)}`}
    function validateCustomer(){let valid=true;const phone=$('phone');setInvalid(phone,!phone.checkValidity());if(!phone.checkValidity())valid=false;['firstName','lastName','email'].forEach(id=>{const el=$(id);const max=id==='email'?254:80;const bad=!el.value.trim()||el.value.trim().length>max||(id==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value.trim()));setInvalid(el,bad);if(bad)valid=false});return valid}
    $('customer-form').addEventListener('submit',event=>{event.preventDefault();if(!validateCustomer()){$('customer-form').querySelector('.is-invalid')?.focus();return}state.customer={firstName:$('firstName').value.trim(),lastName:$('lastName').value.trim(),email:$('email').value.trim(),phone:$('phone').value.trim()};goTo(2)});
    $('phone').addEventListener('input',event=>{event.target.value=normalizePhone(event.target.value);if(event.target.classList.contains('is-invalid'))setInvalid(event.target,false)});
    ['firstName','lastName','email'].forEach(id=>$(id).addEventListener('input',event=>{if(event.target.classList.contains('is-invalid'))setInvalid(event.target,false)}));
    $('start-order').addEventListener('click',startOrder);
    $('sign-in').addEventListener('click',()=>requestAuthAction('sign-in'));
    $('account-settings').addEventListener('click',()=>requestAuthAction('account-settings'));
    $('sign-out').addEventListener('click',signOut);
    $('create-account').addEventListener('click',()=>requestAuthAction('create-account'));
    $('orders-button').addEventListener('click',showOrders);
    $('portal-place-order').addEventListener('click',startOrder);
    $('portal-view-order').addEventListener('click',loadCustomerOrders);
    $('portal-home').addEventListener('click',showHome);
    $('home-link').addEventListener('click',event=>{event.preventDefault();showHome()});
    $('to-payment').addEventListener('click',()=>{ $('menu-error').textContent=''; if(!validatePizzaQuantities(true))return; if(state.pizzas.some(pizza=>!pizza.size)){$('menu-error').textContent='Choose a size for every pizza, or remove any unfinished pizzas.';return}if(state.sides.some(side=>!Number.isInteger(side.quantity)||side.quantity<1||side.quantity>99)){$('menu-error').textContent='Enter a side quantity from 1 to 99.';$('sides-list').querySelector('.side-quantity-input:invalid')?.focus();return}if(state.drinks.some(drink=>!drink.name||!drink.size)){$('menu-error').textContent='Choose a drink and size for each drink you added.';$('drinks-list').querySelector('.drink-name-select')?.focus();return}goTo(3)});
    $('add-pizza').addEventListener('click',()=>{if(getPizzaCount()>=nMaxPizzaCount){$('menu-error').textContent='You can order up to 30 pizzas online. For larger orders, call 931-372-3122.';return;}const pizza={id:nextPizzaId++,size:null,toppings:[]};state.pizzas.push(pizza);state.activePizzaId=pizza.id;renderAll();const card=$('pizzas-container').lastElementChild;card?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});card?.querySelector('.toggle-pizza')?.focus({preventScroll:true})});
    $('add-drink').addEventListener('click',()=>{const drink={id:nextDrinkId++,name:'',size:'',quantity:1};state.drinks.push(drink);renderAll();const row=$('drinks-list').lastElementChild;row?.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});row?.querySelector('.drink-name-select')?.focus({preventScroll:true})});
    document.querySelectorAll('[data-go]').forEach(button=>button.addEventListener('click',()=>{const nTarget=Number(button.dataset.go);if(nTarget===1&&objAuthState.user)showHome();else goTo(nTarget)}));
    $('payment-form').addEventListener('submit',async objEvent=>{
      objEvent.preventDefault();if(submitting)return;
      if(!validateCustomer()){$('order-error').textContent='Enter your name, email and phone before placing the order.';goTo(1);return;}
      state.customer={firstName:$('firstName').value.trim(),lastName:$('lastName').value.trim(),email:$('email').value.trim(),phone:$('phone').value.trim()};
      submitting=true;$('place-order').disabled=true;$('order-error').textContent='Placing your order…';
      requestKey ||= crypto.randomUUID();
      try{
        const objPayload={requestKey,customer:state.customer,pizzas:checkoutPizzas(),sides:state.sides,drinks:state.drinks};
        if(typeof beginStripeCheckout!=='function')throw Error('Secure card checkout is loading. Please retry.');
        await beginStripeCheckout(objPayload);
      }catch(objError){$('order-error').textContent=objError.message||'Unable to place order. Retry shortly.';}
      finally{submitting=false;$('place-order').disabled=false;}
    });
    function showPaidOrder(order,customer){
      $('order-number').textContent=order.orderNumber;$('confirm-name').textContent=order.customer?.name||`${customer.firstName} ${customer.lastName}`;$('confirm-email').textContent=order.customer?.email||customer.email;$('receipt-lines').replaceChildren();
      for(const item of order.items){const row=document.createElement('div');row.className='summary-line';const name=document.createElement('span'),value=document.createElement('span');name.textContent=`${item.description} × ${item.quantity}`;value.textContent=money(item.unit*item.quantity/100);row.append(name,value);$('receipt-lines').append(row)}
      $('receipt-total').textContent=money(order.totalCents/100);$('receipt-details').textContent='Paid by card · '+order.paymentStatus;$('receipt-contact').textContent=`${order.customer?.name||customer.firstName+' '+customer.lastName} · ${order.customer?.email||customer.email} · ${order.customer?.phone||customer.phone}`;$('receipt-subtotal').textContent=money(order.subtotalCents/100);$('receipt-tax').textContent=money(order.taxCents/100);$('receipt-tracker').href=order.trackerUrl;$('order-error').textContent='';
    }
    $('new-order').addEventListener('click',()=>{requestKey=null;state.customer=objAuthState.user?{firstName:objAuthState.user.firstName,lastName:objAuthState.user.lastName,email:objAuthState.user.email,phone:objAuthState.user.phone}:{firstName:'',lastName:'',email:'',phone:''};const objPizza={id:nextPizzaId++,size:null,toppings:[]};state.pizzas=[objPizza];state.activePizzaId=objPizza.id;state.sides=[];state.drinks=[];$('customer-form').reset();if(objAuthState.user){$('firstName').value=state.customer.firstName;$('lastName').value=state.customer.lastName;$('email').value=state.customer.email;$('phone').value=state.customer.phone;}$('payment-form').reset();document.querySelectorAll('.is-invalid').forEach(el=>setInvalid(el,false));$('menu-error').textContent='';renderAll();goTo(canSkipContactDetails()?2:1)});
    $('confirmation-home').addEventListener('click',showHome);

    $('start-order').disabled=true;
    fetch('/api/menu').then(async response=>{if(!response.ok)throw Error('Menu unavailable');return response.json()}).then(rows=>{
      prices={pizza:{},topping:0,sides:{None:0},drinks:{},beverages:{}};toppingChoices=[];objToppingPrices={};drinkChoices=[];
      const mapMenuPriceGroups=new Map([['pizza',prices.pizza],['side',prices.sides],['drink',prices.drinks]]);
      for(const objMenuRow of rows){
        if(objMenuRow.category==='topping'){toppingChoices.push(objMenuRow.name);objToppingPrices[objMenuRow.name]=objMenuRow.price_cents/100;}
        else if(objMenuRow.category==='drink_name'){drinkChoices.push(objMenuRow.name);prices.beverages[objMenuRow.name]=objMenuRow.price_cents/100;}
        else{
          // Custom admin categories have no checkout model yet; keep supported items available.
          const objPriceGroup=mapMenuPriceGroups.get(objMenuRow.category);
          if(objPriceGroup)objPriceGroup[objMenuRow.name]=objMenuRow.price_cents/100;
        }
      }
      renderAll();$('start-order').disabled=false;
    }).catch(()=>{const p=document.createElement('p');p.setAttribute('role','alert');p.textContent='Ordering is currently unavailable. Please call the restaurant.';$('start-order').after(p)});
    fetch('/api/session').then(async objResponse=>{const objSession=await objResponse.json();if(!objAuthState.demo)setAuthState(objSession)}).catch(()=>{if(!objAuthState.demo)setAuthState({authenticated:false,authReady:false})});
    renderAll();

  