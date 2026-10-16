const arrTrackerStages=['order_received','order_confirmed','preparing_order','cooking_order','order_ready'];
const arrTrackerLabels=['Order received','Order confirmed','Preparing order','Cooking order','Order ready'];
const strTrackingToken=new URLSearchParams(location.search).get('token')||'';
const getTrackerElement=strId=>document.getElementById(strId);
let bTrackerPaused=false,bTrackerBusy=false,bTrackerFinished=false,strPreviousMessage='';
async function refreshTracker(){
 if(bTrackerBusy)return;
 if(!/^[0-9a-f]{64}$/.test(strTrackingToken)){getTrackerElement('tracker-message').textContent='Use the complete tracker link from your receipt.';return;}
 bTrackerBusy=true;
 try{
  const objResponse=await fetch(`/api/orders/${strTrackingToken}/track`,{cache:'no-store'});
  const objOrder=await objResponse.json();if(!objResponse.ok)throw Error(objOrder.error||'Unable to load order.');
  const nStage=arrTrackerStages.indexOf(objOrder.status);if(nStage<0)throw Error('Order status unavailable.');
  getTrackerElement('tracker-order').textContent=objOrder.orderNumber;
  const strMessage=objOrder.cancelled?'This order was cancelled.':objOrder.completed?'Your order has been picked up.':arrTrackerLabels[nStage];
  if(strPreviousMessage!==strMessage)getTrackerElement('tracker-message').textContent=strMessage;
  strPreviousMessage=strMessage;bTrackerFinished=objOrder.completed||objOrder.cancelled||objOrder.status==='order_ready';
  const objStages=getTrackerElement('tracker-stages');objStages.replaceChildren();
  arrTrackerLabels.forEach((strLabel,nIndex)=>{const objStep=document.createElement('li');objStep.className='list-group-item'+(nIndex===nStage?' active':'');objStep.textContent=strLabel+(nIndex<nStage?' · Complete':'');if(nIndex===nStage)objStep.setAttribute('aria-current','step');objStages.append(objStep);});
  getTrackerElement('tracker-progress').setAttribute('aria-valuenow',String(nStage+1));getTrackerElement('tracker-progress').setAttribute('aria-valuetext',strMessage);getTrackerElement('tracker-fill').style.width=`${(nStage+1)*20}%`;
  getTrackerElement('tracker-estimate').textContent=objOrder.estimatedPickupTime?`Estimated pickup: ${new Date(objOrder.estimatedPickupTime).toLocaleString()}`:'Awaiting kitchen confirmation…';
 }catch(objError){getTrackerElement('tracker-message').textContent=objError.message+' Automatic updates will retry.';strPreviousMessage='';}
 finally{bTrackerBusy=false;}
}
getTrackerElement('tracker-refresh').addEventListener('click',refreshTracker);
getTrackerElement('tracker-pause').addEventListener('click',()=>{bTrackerPaused=!bTrackerPaused;getTrackerElement('tracker-pause').setAttribute('aria-pressed',String(bTrackerPaused));getTrackerElement('tracker-pause').textContent=bTrackerPaused?'Resume automatic updates':'Pause automatic updates';});
setInterval(()=>{if(!bTrackerPaused&&!bTrackerFinished&&!document.hidden)refreshTracker();},5000);
refreshTracker();
