const dayKey=objDate=>new Date(objDate).toISOString().slice(0,10);
const dayOffset=(objDate,nOffset)=>new Date(Date.UTC(objDate.getUTCFullYear(),objDate.getUTCMonth(),objDate.getUTCDate()+nOffset));
function makeDays(objNow,nDays,fnValue){return Array.from({length:nDays},(_,nIndex)=>{const strDate=dayKey(dayOffset(objNow,nIndex-nDays+1));return {label:strDate,value:fnValue(strDate)};});}
export function calculateAnalytics(arrOrders,arrItems,arrEvents=[],arrAccounts=[],objNow=new Date()){
 const strToday=dayKey(objNow),mapOrders=new Map(arrOrders.map(objOrder=>[String(objOrder.id),objOrder]));
 const arrIncluded=arrOrders.filter(objOrder=>objOrder.status!=='cancelled');
 const arrToday=arrIncluded.filter(objOrder=>dayKey(objOrder.created_at)===strToday);
 const arrSoldItems=arrItems.filter(objItem=>mapOrders.get(String(objItem.order_id))?.status!=='cancelled'&&mapOrders.has(String(objItem.order_id)));
 function pizzasOn(strDay){return arrSoldItems.filter(objItem=>objItem.kind==='pizza'&&dayKey(mapOrders.get(String(objItem.order_id)).created_at)===strDay).reduce((nTotal,objItem)=>nTotal+Number(objItem.quantity),0);}
 function salesOn(strDay){return arrIncluded.filter(objOrder=>dayKey(objOrder.created_at)===strDay).reduce((nTotal,objOrder)=>nTotal+Number(objOrder.total_cents),0);}
 function ordering(strType){
  let arrPoints,strTitle,strLabel;
  if(strType==='today'){arrPoints=[{label:'Today',value:pizzasOn(strToday)}];strTitle='Today’s pizzas';strLabel='Today';}
  else if(strType==='comparison'){arrPoints=makeDays(objNow,2,pizzasOn);strTitle='Pizzas · yesterday vs today';strLabel='Today';}
  else if(strType==='average'){arrPoints=makeDays(objNow,30,pizzasOn);strTitle='Daily pizzas · 30 days';strLabel='30-day daily average';}
  else if(strType==='weekdays'){
   const arrDays=makeDays(objNow,56,pizzasOn);arrPoints=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((strDay,nDay)=>({label:strDay,value:Number((arrDays.filter(objPoint=>new Date(objPoint.label+'T00:00:00Z').getUTCDay()===nDay).reduce((nSum,objPoint)=>nSum+objPoint.value,0)/8).toFixed(1))}));strTitle='Average by weekday';strLabel='8-week weekday average';
  }else if(strType==='monthly'){
   arrPoints=Array.from({length:6},(_,nIndex)=>{const objMonth=new Date(Date.UTC(objNow.getUTCFullYear(),objNow.getUTCMonth()+nIndex-5,1)),strMonth=dayKey(objMonth).slice(0,7);return {label:objMonth.toLocaleString('en-US',{month:'short',year:'numeric',timeZone:'UTC'}),value:arrSoldItems.filter(objItem=>objItem.kind==='pizza'&&dayKey(mapOrders.get(String(objItem.order_id)).created_at).startsWith(strMonth)).reduce((nSum,objItem)=>nSum+Number(objItem.quantity),0)};});strTitle='Monthly pizzas';strLabel='This month';
  }else throw new RangeError('Unsupported analytics period.');
  const nMetric=['average','weekdays'].includes(strType)?Number((arrPoints.reduce((nSum,objPoint)=>nSum+objPoint.value,0)/arrPoints.length).toFixed(1)):arrPoints.at(-1).value;
  return {type:strType,title:strTitle,metricLabel:strLabel,metric:nMetric,points:arrPoints,synthetic:false,asOf:strToday,timeZone:'UTC'};
 }
 function products(strLeft,strRight,strPeriod){
  if(!['week','month','months'].includes(strPeriod))throw new RangeError('Unsupported product period.');
  function matches(objItem,strKey){const nColon=strKey.indexOf(':'),strKind=strKey.slice(0,nColon),strName=strKey.slice(nColon+1);if(strKind==='pizza')return objItem.kind==='pizza'&&objItem.description.toLowerCase().startsWith(strName.toLowerCase()+' pizza');if(strKind==='topping')return objItem.kind==='pizza'&&objItem.description.split(/ with /i)[1]?.split(', ').includes(strName);return objItem.kind===strKind&&objItem.description===strName;}
  if(![strLeft,strRight].every(strKey=>/^(pizza|topping|side|drink):.{1,100}$/.test(strKey)))throw new RangeError('Unsupported product.');
  const arrLabels=strPeriod==='months'?Array.from({length:6},(_,nIndex)=>dayKey(new Date(Date.UTC(objNow.getUTCFullYear(),objNow.getUTCMonth()+nIndex-5,1))).slice(0,7)):makeDays(objNow,strPeriod==='month'?30:7,()=>0).map(objPoint=>objPoint.label);
  return {synthetic:false,title:'Recorded item quantities',period:strPeriod==='months'?'Last 6 months':strPeriod==='month'?'Last 30 days':'Last 7 days',labels:arrLabels,series:[strLeft,strRight].map(strKey=>({key:strKey,label:strKey.split(':').slice(1).join(':'),values:arrLabels.map(strDate=>arrSoldItems.filter(objItem=>matches(objItem,strKey)&&dayKey(mapOrders.get(String(objItem.order_id)).created_at).startsWith(strDate)).reduce((nSum,objItem)=>nSum+Number(objItem.quantity),0))})),asOf:strToday};
 }
 const nTodaySales=salesOn(strToday),nAllToday=arrOrders.filter(objOrder=>dayKey(objOrder.created_at)===strToday).length;
 const objBusiness={synthetic:false,asOf:strToday,ordersToday:arrToday.length,pizzasToday:pizzasOn(strToday),salesTodayCents:nTodaySales,averageOrderCents:arrToday.length?Math.round(nTodaySales/arrToday.length):0,cancellationRate:nAllToday?Number(((nAllToday-arrToday.length)*100/nAllToday).toFixed(1)):0,weeklySales:makeDays(objNow,7,salesOn),basis:'Non-cancelled order value, not settled payment revenue. UTC calendar days.'};
 const arrCardToday=arrOrders.filter(objOrder=>dayKey(objOrder.created_at)===strToday&&['online','card'].includes(objOrder.payment_method)&&['paid','partially_refunded','refunded'].includes(objOrder.payment_status));
 objBusiness.paidCardCents=arrCardToday.reduce((nSum,objOrder)=>nSum+Math.max(0,Number(objOrder.total_cents)-Number(objOrder.refunded_cents||0)),0);
 objBusiness.refundedCardCents=arrCardToday.reduce((nSum,objOrder)=>nSum+Number(objOrder.refunded_cents||0),0);
 const arrEmployees=arrAccounts.filter(objAccount=>objAccount.role==='admin').map(objAccount=>{
  const arrActions=arrEvents.filter(objEvent=>objEvent.actor_email===objAccount.email&&objEvent.event_type==='status_changed');
  const countOn=strDate=>new Set(arrActions.filter(objEvent=>dayKey(objEvent.created_at)===strDate).map(objEvent=>String(objEvent.order_id))).size;
  const arrWeek=makeDays(objNow,7,countOn);
  return {name:`${objAccount.first_name} ${objAccount.last_name}`,role:'Administrator',shift:'Not recorded',shiftStatus:'Not recorded',hoursToday:null,hoursThisWeek:null,ordersToday:countOn(strToday),ordersThisWeek:new Set(arrActions.filter(objEvent=>dayKey(objEvent.created_at)>=arrWeek[0].label).map(objEvent=>String(objEvent.order_id))).size,averagePrepMinutes:null,weeklySeries:arrWeek};
 });
 return {ordering,products,business:objBusiness,employees:{synthetic:false,asOf:strToday,employees:arrEmployees,note:'Distinct orders with attributed status updates. Shift hours and preparation time are not recorded; legacy unattributed actions are excluded.'}};
}
export async function loadAnalytics(objPool){
 const objConnection=await objPool.getConnection();
 try{
  await objConnection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await objConnection.beginTransaction();
  const arrOrders=await objConnection.query("SELECT id,status,total_cents,created_at,payment_method,payment_status,refunded_cents FROM orders WHERE created_at>=DATE_FORMAT(DATE_SUB(UTC_DATE(),INTERVAL 5 MONTH),'%Y-%m-01')");
  const arrItems=await objConnection.query("SELECT i.order_id,i.kind,i.description,i.quantity FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.created_at>=DATE_FORMAT(DATE_SUB(UTC_DATE(),INTERVAL 5 MONTH),'%Y-%m-01')");
  const arrEvents=await objConnection.query('SELECT order_id,actor_email,event_type,created_at FROM order_events WHERE created_at>=DATE_SUB(UTC_DATE(),INTERVAL 7 DAY)');
  const arrAccounts=await objConnection.query("SELECT first_name,last_name,email,role FROM accounts WHERE role='admin'");await objConnection.commit();return calculateAnalytics(arrOrders,arrItems,arrEvents,arrAccounts);
 }catch(objError){await objConnection.rollback();throw objError;}finally{objConnection.release();}
}
