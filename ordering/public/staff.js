const getStaffElement=strId=>document.getElementById(strId);
const arrStaffStages=['order_received','order_confirmed','preparing_order','cooking_order','order_ready'];
const objStageLabels={order_received:'Order received',order_confirmed:'Confirmed',preparing_order:'Preparing',cooking_order:'Cooking',order_ready:'Ready for pickup'};
let bStaffReady=false,bStaffPaused=false,bStaffRefreshing=false,bStaffChanging=false;
function staffMessage(strText){if(getStaffElement('staff-message').textContent!==strText)getStaffElement('staff-message').textContent=strText;}
function staffText(strTag,strText,strClass=''){const objElement=document.createElement(strTag);objElement.textContent=strText;if(strClass)objElement.className=strClass;return objElement;}
async function staffApi(strPath,strMethod='GET',objBody){
 const objResponse=await fetch(strPath,{method:strMethod,cache:'no-store',...(objBody===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(objBody)})});
 const objResult=await objResponse.json();
 if(!objResponse.ok){
  const objError=new Error(objResult.error||'Unable to update orders. Refresh before retrying.');
  objError.status=objResponse.status;throw objError;
 }
 return objResult;
}
function localEstimate(strValue){const dtValue=new Date(strValue);if(Number.isNaN(dtValue.getTime()))return '';return new Date(dtValue.getTime()-dtValue.getTimezoneOffset()*60000).toISOString().slice(0,16);}
function renderStaffOrders(arrOrders){
 const objQueue=getStaffElement('staff-orders');objQueue.replaceChildren();getStaffElement('staff-count').textContent=`${arrOrders.length} active order${arrOrders.length===1?'':'s'}`;
 if(!arrOrders.length){objQueue.append(staffText('p','The kitchen queue is clear. New orders will appear here.'));return;}
 for(const objOrder of arrOrders){
  const objCard=staffText('article','','order-card');objCard.setAttribute('aria-label',`Order LP-${objOrder.id}`);
  objCard.append(staffText('h2',`LP-${objOrder.id} · ${objOrder.customer_name}`),staffText('p',objStageLabels[objOrder.tracking_status]||'Manager review required','stage'));
  const objItems=document.createElement('ul');for(const objItem of objOrder.items||[])objItems.append(staffText('li',`${objItem.quantity} × ${objItem.description}`));objCard.append(objItems);
  objCard.append(staffText('p',`${objOrder.customer_phone||'No phone supplied'} · ${objOrder.customer_email}`,'order-contact'));
  objCard.append(staffText('p',`Total: $${(Number(objOrder.total_cents)/100).toFixed(2)} · Payment: ${objOrder.payment_status||'Check with manager'}`));
  const nStage=arrStaffStages.indexOf(objOrder.tracking_status);
  if(nStage<0){objCard.append(staffText('p','Ask an administrator to review this older order.','hint'));objQueue.append(objCard);continue;}
  const objActions=staffText('div','','actions'),objAdvance=staffText('button',nStage===4?'Mark picked up':`Next: ${objStageLabels[arrStaffStages[nStage+1]]}`,'btn primary');objAdvance.type='button';
  objAdvance.addEventListener('click',()=>changeStaffOrder(objAdvance,`/api/employee/orders/${objOrder.id}/${nStage===4?'complete':'status'}`,nStage===4?'POST':'PATCH',nStage===4?{expectedStatus:'order_ready'}:{expectedStatus:objOrder.tracking_status,status:arrStaffStages[nStage+1]}));objActions.append(objAdvance);objCard.append(objActions);
  const objEstimate=document.createElement('form');objEstimate.className='estimate-form';
  const objLabel=staffText('label','Estimated pickup time (your local time)'),objInput=document.createElement('input');objInput.type='datetime-local';objInput.id=`estimate-${objOrder.id}`;objInput.required=true;const dtSavedEstimate=new Date(objOrder.estimated_pickup_time||'');const dtSuggestedEstimate=new Date(Math.ceil((Date.now()+15*60000)/60000)*60000);objInput.value=localEstimate((Number.isFinite(dtSavedEstimate.getTime())&&dtSavedEstimate.getTime()>Date.now()?dtSavedEstimate:dtSuggestedEstimate).toISOString());objLabel.htmlFor=objInput.id;
  // Handle invalid submissions ourselves so the warning always appears.
  objEstimate.noValidate=true;
  const updateEstimateMinimum=()=>{
   const dtMinimum=new Date(Math.ceil(Date.now()/60000)*60000);
   objInput.min=localEstimate(dtMinimum.toISOString());
  };
  updateEstimateMinimum();
  for(const strEvent of ['focus','click','keydown'])objInput.addEventListener(strEvent,updateEstimateMinimum);
  const objAlert=staffText('div','','alert alert-danger');
  objAlert.id=`estimate-alert-${objOrder.id}`;objAlert.setAttribute('role','alert');objAlert.hidden=true;
  objInput.setAttribute('aria-describedby',objAlert.id);
  let nAlertTimer;
  const showEstimateError=()=>{
   clearTimeout(nAlertTimer);objInput.setAttribute('aria-invalid','true');objAlert.hidden=false;
   objAlert.textContent='Invalid time: You cannot select a pickup time in the past.';objInput.focus();
   nAlertTimer=setTimeout(()=>{objAlert.hidden=true;objAlert.textContent='';},3500);
  };
  const clearEstimateError=()=>{
   clearTimeout(nAlertTimer);objAlert.hidden=true;objAlert.textContent='';objInput.removeAttribute('aria-invalid');
  };
  objInput.addEventListener('input',clearEstimateError);
  const objSave=staffText('button','Save pickup estimate','btn');objSave.type='submit';objEstimate.append(objLabel,objInput,objSave,objAlert);
  objEstimate.addEventListener('submit',objEvent=>{
   objEvent.preventDefault();updateEstimateMinimum();
   const dtEstimate=new Date(objInput.value);
   if(!Number.isFinite(dtEstimate.getTime())||dtEstimate.getTime()<=Date.now()||!objInput.checkValidity()){
    showEstimateError();return;
   }
   clearEstimateError();
   changeStaffOrder(objSave,`/api/employee/orders/${objOrder.id}/estimate`,'PATCH',{estimatedPickupTime:dtEstimate.toISOString()},showEstimateError);
  });objCard.append(objEstimate);objQueue.append(objCard);
 }
}
async function refreshStaffQueue(bForce=false){
 if(!bStaffReady||bStaffRefreshing||(!bForce&&bStaffChanging))return;
 bStaffRefreshing=true;getStaffElement('staff-refresh').disabled=true;
 try{const arrOrders=await staffApi('/api/employee/orders/active');if(!Array.isArray(arrOrders))throw Error('The order queue could not be read.');renderStaffOrders(arrOrders);staffMessage('Kitchen queue is up to date.');}
 catch(objError){staffMessage(objError.message);}
 finally{bStaffRefreshing=false;getStaffElement('staff-refresh').disabled=false;}
}
async function changeStaffOrder(objButton,strPath,strMethod,objBody,fnEstimateError){
 if(bStaffChanging)return;bStaffChanging=true;objButton.disabled=true;
 try{await staffApi(strPath,strMethod,objBody);await refreshStaffQueue(true);staffMessage('Order updated.');getStaffElement('staff-refresh').focus();}
 catch(objError){
  if(objError.status===400&&fnEstimateError)fnEstimateError();
  else staffMessage(objError.message);
 }
 finally{bStaffChanging=false;objButton.disabled=false;}
}
getStaffElement('staff-refresh').addEventListener('click',()=>refreshStaffQueue());
getStaffElement('staff-pause').addEventListener('click',()=>{bStaffPaused=!bStaffPaused;getStaffElement('staff-pause').setAttribute('aria-pressed',String(bStaffPaused));getStaffElement('staff-pause').textContent=bStaffPaused?'Resume automatic updates':'Pause automatic updates';});
setInterval(()=>{if(!bStaffPaused&&!document.hidden&&!getStaffElement('staff-orders').contains(document.activeElement))refreshStaffQueue();},10000);
async function initializeStaffQueue(){
 try{const objSession=await staffApi('/api/session');if(!objSession.authenticated||!['worker','admin'].includes(objSession.user?.role))throw Error('Sign in with your worker or administrator account to use the kitchen queue.');bStaffReady=true;getStaffElement('staff-identity').textContent=`Signed in: ${objSession.user.firstName} ${objSession.user.lastName}`;getStaffElement('staff-admin-link').hidden=objSession.user.role!=='admin';getStaffElement('staff-refresh').disabled=false;getStaffElement('staff-pause').disabled=false;await refreshStaffQueue();}
 catch(objError){staffMessage(objError.message);}
}
getStaffElement('staff-sign-out').addEventListener('click',async()=>{const objButton=getStaffElement('staff-sign-out');objButton.disabled=true;try{await staffApi('/api/auth/logout','POST',{});location.assign('/account?mode=login');}catch(objError){staffMessage(objError.message);objButton.disabled=false;}});
initializeStaffQueue();
