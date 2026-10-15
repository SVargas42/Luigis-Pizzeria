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
