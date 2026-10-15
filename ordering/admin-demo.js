import {buildSyntheticAnalytics, buildSyntheticBusinessData, buildSyntheticEmployeeData, buildSyntheticItemComparison, canTransitionStatus, orderAttention} from './domain.js';
import {normalizeEditableItems} from './validation.js';

const mapMenuPrices = new Map([
  ['pizza:Small',1000],['pizza:Medium',1300],['pizza:Large',1600],
  ...['Cheese','Pepperoni','Sausage','Pineapple','Olives','Barbeque Chicken'].map(strName=>[`topping:${strName}`,150]),
  ['side:Breadsticks',500],['side:Pizza Bites',600],
  ['drink:Small',200],['drink:Medium',275],['drink:Large',350]
]);

export function createDemoAdminState(objNow = new Date()) {
  const fnPlaced = nMinutes => new Date(objNow.getTime()-nMinutes*60*1000).toISOString();
  const arrOrders = [
    {id:'DEMO-101',customer_name:'Demo Customer',customer_email:'customer@example.test',customer_phone:'',status:'preparing',total_cents:1450,created_at:fnPlaced(18),updated_at:fnPlaced(5),items:[{kind:'pizza',description:'Medium pizza with Pepperoni',quantity:1,unit_price_cents:1450}]},
    {id:'DEMO-102',customer_name:'Sample Guest',customer_email:'guest@example.test',customer_phone:'',status:'received',total_cents:2200,created_at:fnPlaced(7),updated_at:fnPlaced(7),items:[{kind:'pizza',description:'Large pizza',quantity:1,unit_price_cents:1600},{kind:'side',description:'Pizza Bites',quantity:1,unit_price_cents:600}]},
    {id:'DEMO-099',customer_name:'Past Demo Guest',customer_email:'past-guest@example.test',customer_phone:'',status:'completed',total_cents:1925,created_at:fnPlaced(125),updated_at:fnPlaced(85),items:[{kind:'pizza',description:'Small pizza with Cheese',quantity:1,unit_price_cents:1150},{kind:'drink',description:'Coke (Medium)',quantity:1,unit_price_cents:275},{kind:'side',description:'Breadsticks',quantity:1,unit_price_cents:500}]}
  ];
  return {orders:arrOrders};
}

export function handleDemoAdminRequest(strPath, objOptions, objState, objNow = new Date()) {
  const objUrl = new URL(strPath,'https://demo.local');
  const strMethod = objOptions.method || 'GET';
  if (strMethod === 'GET' && objUrl.pathname === '/api/admin/orders') {
    const strBucket = objUrl.searchParams.get('bucket') === 'past' ? 'past' : 'current';
    return objState.orders.filter(objOrder => (['completed','cancelled'].includes(objOrder.status)) === (strBucket === 'past')).map(objOrder=>({...objOrder,items:objOrder.items.map(objItem=>({...objItem})),needsAttention:orderAttention(objOrder,objNow)}));
  }
  if (strMethod === 'GET' && objUrl.pathname === '/api/admin/analytics') return buildSyntheticAnalytics(objUrl.searchParams.get('view') || 'today',objNow);
  if (strMethod === 'GET' && objUrl.pathname === '/api/admin/analytics/products') return buildSyntheticItemComparison(objUrl.searchParams.get('left')||'pizza:Small',objUrl.searchParams.get('right')||'drink:Dr Pepper (Medium)',objUrl.searchParams.get('period')||'week',objNow);
  if (strMethod === 'GET' && objUrl.pathname === '/api/admin/analytics/employees') return buildSyntheticEmployeeData(objNow);
  if (strMethod === 'GET' && objUrl.pathname === '/api/admin/analytics/business') return buildSyntheticBusinessData(objNow);
  if (strMethod === 'GET' && objUrl.pathname === '/api/admin/customers') {
    const strQuery=(objUrl.searchParams.get('q')||'').toLowerCase();
    return [
      {first_name:'Demo',last_name:'Customer',email:'customer@example.test',phone:'',order_count:2,total_cents:1450,last_order:objState.orders[0].created_at},
      {first_name:'Sample',last_name:'Guest',email:'guest@example.test',phone:'',order_count:1,total_cents:2200,last_order:objState.orders[1].created_at}
    ].filter(objCustomer=>`${objCustomer.email} ${objCustomer.last_name}`.toLowerCase().includes(strQuery));
  }
  const objStatusMatch=objUrl.pathname.match(/^\/api\/admin\/orders\/(DEMO-\d+)$/);
  if (strMethod === 'PATCH' && objStatusMatch) {
    const objOrder=objState.orders.find(objItem=>objItem.id===objStatusMatch[1]);
    if(!objOrder)throw new Error('Demo order not found.');
    const strStatus=JSON.parse(objOptions.body||'{}').status;
    if(!canTransitionStatus(objOrder.status,strStatus))throw new Error('Choose an allowed next status for this demo order.');
    objOrder.status=strStatus;objOrder.updated_at=objNow.toISOString();
    return {status:strStatus};
  }
  const objEditMatch=objUrl.pathname.match(/^\/api\/admin\/orders\/(DEMO-\d+)\/items$/);
  if(strMethod==='PATCH'&&objEditMatch){
    const objOrder=objState.orders.find(objItem=>objItem.id===objEditMatch[1]);
    if(!objOrder||!['received','preparing','ready'].includes(objOrder.status))throw new Error('Only current demo orders can be edited.');
    const arrItems=normalizeEditableItems(JSON.parse(objOptions.body||'{}').items,mapMenuPrices).map(objItem=>({kind:objItem.kind,description:objItem.description,quantity:objItem.quantity,unit_price_cents:objItem.unit}));
    if(!arrItems.length||arrItems.length>40)throw new Error('A demo order needs 1 to 40 items.');
    objOrder.items=arrItems;objOrder.total_cents=arrItems.reduce((nTotal,objItem)=>nTotal+objItem.quantity*objItem.unit_price_cents,0);objOrder.updated_at=objNow.toISOString();
    return {items:arrItems.map(objItem=>({kind:objItem.kind,description:objItem.description,quantity:objItem.quantity,unit:objItem.unit_price_cents})),totalCents:objOrder.total_cents};
  }
  throw new Error('Unsupported demo staff request.');
}
