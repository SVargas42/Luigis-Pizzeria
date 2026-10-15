const arrCurrentStatuses = ['received', 'preparing', 'ready'];
const objStatusNames = {received: 'Order received', preparing: 'Being prepared', ready: 'Ready for pickup', completed: 'Picked up', cancelled: 'Cancelled'};
const objAllowedTransitions = {received: ['preparing', 'cancelled'], preparing: ['ready', 'cancelled'], ready: ['completed', 'cancelled'], completed: [], cancelled: []};

export function canTransitionStatus(strCurrent,strNext) {
  return Boolean(objAllowedTransitions[strCurrent]?.includes(strNext));
}

export function orderBucket(strStatus) {
  return ['completed', 'cancelled'].includes(strStatus) ? 'past' : 'current';
}

export function orderAttention(objOrder, objNow = new Date()) {
  if (!arrCurrentStatuses.includes(objOrder.status)) return false;
  const nPlaced = new Date(objOrder.created_at).getTime();
  return Number.isFinite(nPlaced) && objNow.getTime() - nPlaced >= 45 * 60 * 1000;
}

export function statusLabel(strStatus) {
  return objStatusNames[strStatus] || 'Status unavailable';
}

function dayStamp(objDate) {
  return objDate.toISOString().slice(0, 10);
}

function syntheticPizzas(objDate) {
  const nDay = Math.floor(Date.UTC(objDate.getUTCFullYear(), objDate.getUTCMonth(), objDate.getUTCDate()) / 86400000);
  // A date-based seed keeps the preview stable across refreshes and never writes sample data to the order database.
  const nSeed = Math.abs((nDay * 9301 + 49297) % 233280);
  return 18 + (nSeed % 31) + (objDate.getUTCDay() === 5 || objDate.getUTCDay() === 6 ? 12 : 0);
}

function addDays(objDate, nOffset) {
  const objResult = new Date(Date.UTC(objDate.getUTCFullYear(), objDate.getUTCMonth(), objDate.getUTCDate()));
  objResult.setUTCDate(objResult.getUTCDate() + nOffset);
  return objResult;
}

function monthLabel(objDate) {
  return objDate.toLocaleString('en-US', {month: 'short', timeZone: 'UTC'});
}

export function buildSyntheticAnalytics(strType, objNow = new Date()) {
  const objToday = new Date(Date.UTC(objNow.getUTCFullYear(), objNow.getUTCMonth(), objNow.getUTCDate()));
  const objYesterday = addDays(objToday, -1);
  let arrPoints = [];
  let strTitle = '';
  let strMetricLabel = '';
  let nMetric = 0;

  if (strType === 'today') {
    strTitle = 'Pizzas today';
    strMetricLabel = `Simulated orders for ${dayStamp(objToday)}`;
    nMetric = syntheticPizzas(objToday);
    arrPoints = [{label: 'Today', value: nMetric}];
  } else if (strType === 'comparison') {
    strTitle = 'Yesterday compared with today';
    strMetricLabel = 'Pizzas today';
    nMetric = syntheticPizzas(objToday);
    arrPoints = [{label: dayStamp(objYesterday), value: syntheticPizzas(objYesterday)}, {label: dayStamp(objToday), value: nMetric}];
  } else if (strType === 'weekdays') {
    strTitle = 'Average by day of week';
    strMetricLabel = 'Average pizzas per weekday over the last 8 weeks';
    const arrTotals = Array(7).fill(0);
    const arrCounts = Array(7).fill(0);
    for (let nOffset = -55; nOffset <= 0; nOffset++) {
      const objDate = addDays(objToday, nOffset);
      arrTotals[objDate.getUTCDay()] += syntheticPizzas(objDate);
      arrCounts[objDate.getUTCDay()]++;
    }
    arrPoints = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((label, index) => ({label, value: Math.round(arrTotals[index] / arrCounts[index])}));
    nMetric = Math.round(arrPoints.reduce((nSum, objPoint) => nSum + objPoint.value, 0) / arrPoints.length);
  } else if (strType === 'average') {
    strTitle = 'Daily average';
    strMetricLabel = 'Average pizzas per day over the last 30 days';
    arrPoints = Array.from({length: 30}, (_, index) => {
      const objDate = addDays(objToday, index - 29);
      return {label: dayStamp(objDate), value: syntheticPizzas(objDate)};
    });
    nMetric = Math.round(arrPoints.reduce((nSum, objPoint) => nSum + objPoint.value, 0) / arrPoints.length);
  } else if (strType === 'monthly') {
    strTitle = 'Monthly pizzas';
    strMetricLabel = 'Simulated monthly totals through today';
    arrPoints = Array.from({length: 6}, (_, index) => {
      const nMonthOffset = index - 5;
      const objMonth = new Date(Date.UTC(objToday.getUTCFullYear(), objToday.getUTCMonth() + nMonthOffset, 1));
      const objLastDay = nMonthOffset === 0 ? objToday : new Date(Date.UTC(objMonth.getUTCFullYear(), objMonth.getUTCMonth() + 1, 0));
      let nTotal = 0;
      for (let objDate = objMonth; objDate <= objLastDay; objDate = addDays(objDate, 1)) nTotal += syntheticPizzas(objDate);
      return {label: `${monthLabel(objMonth)} ${objMonth.getUTCFullYear()}`, value: nTotal};
    });
    nMetric = arrPoints.at(-1).value;
  } else {
    throw new RangeError('Choose a supported analytics view.');
  }

  return {type: strType, title: strTitle, metricLabel: strMetricLabel, metric: nMetric, points: arrPoints, synthetic: true, asOf: dayStamp(objToday)};
}

function itemFactor(strItemKey) {
  let nHash=0;
  for(const strCharacter of strItemKey)nHash=(nHash*31+strCharacter.charCodeAt(0))%997;
  const strCategory=strItemKey.split(':')[0];
  const nBase={pizza:.42,drink:.22,side:.13,topping:.2}[strCategory]||.1;
  return nBase*(.72+(nHash%57)/100);
}

export function buildSyntheticItemComparison(strLeftKey,strRightKey,strPeriod='week',objNow=new Date()) {
  const objSeries=strPeriod==='month'?buildSyntheticAnalytics('average',objNow).points:buildSyntheticAnalytics('average',objNow).points.slice(-7);
  const arrPoints=objSeries.map(objPoint=>({label:objPoint.label,value:objPoint.value}));
  const objMonth=strPeriod==='months'?buildSyntheticAnalytics('monthly',objNow).points:null;
  const fnValues=strKey=>{
    const nFactor=itemFactor(strKey);
    const arrBase=objMonth?objMonth.map(objPoint=>objPoint.value):arrPoints.map(objPoint=>objPoint.value);
    return arrBase.map((nBase,nIndex)=>Math.max(0,Math.round(nBase*nFactor*(1+((nIndex*7+strKey.length)%11)/40))));
  };
  const arrLabels=objMonth?objMonth.map(objPoint=>objPoint.label):arrPoints.map(objPoint=>objPoint.label);
  const objToday=buildSyntheticAnalytics('today',objNow);
  return {
    synthetic:true,
    title:`${strLeftKey.replace(':',' · ')} compared with ${strRightKey.replace(':',' · ')}`,
    period:strPeriod==='months'?'Last 6 months':strPeriod==='month'?'Last 30 days':'Last 7 days',
    labels:arrLabels,
    series:[{key:strLeftKey,label:strLeftKey.split(':').slice(1).join(':')||strLeftKey,values:fnValues(strLeftKey)},{key:strRightKey,label:strRightKey.split(':').slice(1).join(':')||strRightKey,values:fnValues(strRightKey)}],
    asOf:objToday.asOf
  };
}

export function buildSyntheticEmployeeData(objNow=new Date()) {
  const nHour=objNow.getUTCHours()+objNow.getUTCMinutes()/60;
  const nWeekday=(objNow.getUTCDay()+6)%7;
  const arrWorkDays=[[0,1,3,4],[1,2,4,5],[0,2,3,5],[0,1,2,3,4]];
  const arrEmployees=['A','B','C','D'].map((strCode,nIndex)=>{
    const nStart=8+(nIndex%3)*2,nEnd=nStart+6;
    const bWorksToday=arrWorkDays[nIndex].includes(nWeekday);
    const nProgress=bWorksToday?Math.max(0,Math.min(1,(nHour-nStart)/(nEnd-nStart))):0;
    const nShiftOrders=Math.floor((12+nIndex*3)*nProgress);
    const nShiftHours=Number((6*nProgress).toFixed(1));
    const strShiftStatus=!bWorksToday?'Off today':nProgress===0?'Upcoming':nProgress===1?'Completed':'In progress';
    const nShiftsCompleted=arrWorkDays[nIndex].filter(nDay=>nDay<nWeekday).length;
    const nHoursThisWeek=nShiftsCompleted*6+nShiftHours;
    const nOrdersThisWeek=nShiftsCompleted*(12+nIndex*3)+nShiftOrders;
    return {name:`Demo Employee ${strCode}`,role:['Pizza maker','Order coordinator','Kitchen lead','Delivery prep'][nIndex],shift:bWorksToday?`${String(nStart).padStart(2,'0')}:00–${String(nEnd).padStart(2,'0')}:00 UTC`:'No shift scheduled today',shiftStatus:strShiftStatus,hoursToday:nShiftHours,ordersToday:nShiftOrders,shiftsThisWeek:nShiftsCompleted,hoursThisWeek:Number(nHoursThisWeek.toFixed(1)),ordersThisWeek:nOrdersThisWeek,averagePrepMinutes:14+nIndex*2};
  });
  return {synthetic:true,asOf:dayStamp(new Date(Date.UTC(objNow.getUTCFullYear(),objNow.getUTCMonth(),objNow.getUTCDate()))),employees:arrEmployees};
}

export function buildSyntheticBusinessData(objNow=new Date()) {
  const objDaily=buildSyntheticAnalytics('average',objNow).points.slice(-7);
  const nTodayPizzas=buildSyntheticAnalytics('today',objNow).metric;
  const fnOrders=nPizzas=>Math.max(1,Math.round(nPizzas*.72));
  const fnSales=nPizzas=>fnOrders(nPizzas)*2650;
  const arrSales=objDaily.map(objPoint=>({label:objPoint.label,value:fnSales(objPoint.value)}));
  const nTodayOrders=fnOrders(nTodayPizzas),nTodaySales=fnSales(nTodayPizzas);
  return {synthetic:true,asOf:buildSyntheticAnalytics('today',objNow).asOf,ordersToday:nTodayOrders,pizzasToday:nTodayPizzas,salesTodayCents:nTodaySales,averageOrderCents:2650,cancellationRate:2.4,weeklySales:arrSales};
}
