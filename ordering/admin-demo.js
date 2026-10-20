import {buildSyntheticAnalytics, buildSyntheticBusinessData, buildSyntheticEmployeeData, buildSyntheticItemComparison, canTransitionStatus, orderAttention} from './domain.js';
import {normalizeEditableItems} from './validation.js';

const arrDefaultMenu=[
  ...[['pizza','Small',1000],['pizza','Medium',1300],['pizza','Large',1600]],
  ...['Cheese','Pepperoni','Sausage','Pineapple','Olives','Barbeque Chicken'].map(strName=>['topping',strName,150]),
  ['side','Breadsticks',500],['side','Pizza Bites',600],
  ...[['drink','Small',200],['drink','Medium',275],['drink','Large',350]],
  ...['Coke','Pepsi','Dr Pepper','Water'].map(strName=>['drink_name',strName,0])
].map(([category,name,price_cents])=>({category,name,price_cents}));
const menuMap=objState=>new Map(objState.menuRows.map(objRow=>[`${objRow.category}:${objRow.name}`,objRow.price_cents]));

export function createDemoAdminState(objNow = new Date()) {
  const fnPlaced = nMinutes => new Date(objNow.getTime()-nMinutes*60*1000).toISOString();
  const arrOrders = [
    {id:'101',customer_name:'Alex Morgan',customer_email:'alex.morgan@example.com',customer_phone:'',status:'preparing',total_cents:1450,created_at:fnPlaced(18),updated_at:fnPlaced(5),items:[{kind:'pizza',description:'Medium pizza with Pepperoni',quantity:1,unit_price_cents:1450}]},
    {id:'102',customer_name:'Jamie Carter',customer_email:'jamie.carter@example.com',customer_phone:'',status:'received',total_cents:2200,created_at:fnPlaced(7),updated_at:fnPlaced(7),items:[{kind:'pizza',description:'Large pizza',quantity:1,unit_price_cents:1600},{kind:'side',description:'Pizza Bites',quantity:1,unit_price_cents:600}]},
    {id:'99',customer_name:'Morgan Ellis',customer_email:'morgan.ellis@example.com',customer_phone:'',status:'completed',total_cents:1925,created_at:fnPlaced(125),updated_at:fnPlaced(85),items:[{kind:'pizza',description:'Small pizza with Cheese',quantity:1,unit_price_cents:1150},{kind:'drink',description:'Coke (Medium)',quantity:1,unit_price_cents:275},{kind:'side',description:'Breadsticks',quantity:1,unit_price_cents:500}]}
  ];
  return {orders:arrOrders,menuRows:arrDefaultMenu.map(objRow=>({...objRow}))};
}

export function handleDemoAdminRequest(strPath, objOptions, objState, objNow = new Date()) {
  const objUrl = new URL(strPath,'https://demo.local');
  const strMethod = objOptions.method || 'GET';
  if(strMethod==='GET'&&['/api/menu','/api/admin/menu'].includes(objUrl.pathname))return objState.menuRows.map(objRow=>({...objRow}));
  if(strMethod==='POST'&&objUrl.pathname==='/api/admin/menu'){
    const objEntry=JSON.parse(objOptions.body||'{}'),strName=typeof objEntry.name==='string'?objEntry.name.trim():'';
    if(!['pizza','topping','side','drink','drink_name'].includes(objEntry.category)||!/^[A-Za-z0-9][A-Za-z0-9 '&-]{0,59}$/.test(strName)||!Number.isInteger(objEntry.priceCents)||objEntry.priceCents<0||objEntry.priceCents>1000000||(objEntry.category!=='drink_name'&&objEntry.priceCents===0))throw new Error('Enter a valid menu type, item name, and price.');
    if(objState.menuRows.some(objRow=>objRow.category===objEntry.category&&objRow.name.toLowerCase()===strName.toLowerCase()))throw new Error('That menu item already exists in this category.');
    const objNew={category:objEntry.category,name:strName,price_cents:objEntry.priceCents};objState.menuRows.push(objNew);return {...objNew};
  }
  const objMenuEdit=objUrl.pathname.match(/^\/api\/admin\/menu\/(pizza|topping|side|drink|drink_name)\/([^/]+)$/);
  if(strMethod==='PATCH'&&objMenuEdit){
    const strCategory=objMenuEdit[1],strPrevious=decodeURIComponent(objMenuEdit[2]),objEntry=JSON.parse(objOptions.body||'{}'),strName=typeof objEntry.name==='string'?objEntry.name.trim():'';
    if(!/^[A-Za-z0-9][A-Za-z0-9 '&-]{0,59}$/.test(strName)||!Number.isInteger(objEntry.priceCents)||objEntry.priceCents<0||objEntry.priceCents>1000000||(strCategory!=='drink_name'&&objEntry.priceCents===0))throw new Error('Enter a valid item name and price.');
    if(objState.menuRows.some(objRow=>objRow.category===strCategory&&objRow.name.toLowerCase()===strName.toLowerCase()&&objRow.name!==strPrevious))throw new Error('That menu item already exists in this category.');
    const objTarget=objState.menuRows.find(objRow=>objRow.category===strCategory&&objRow.name===strPrevious);if(!objTarget)throw new Error('Menu item not found.');
    objTarget.name=strName;objTarget.price_cents=objEntry.priceCents;return {...objTarget};
  }
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
      {first_name:'Alex',last_name:'Morgan',email:'alex.morgan@example.com',phone:'',order_count:2,total_cents:1450,last_order:objState.orders[0].created_at},
      {first_name:'Jamie',last_name:'Carter',email:'jamie.carter@example.com',phone:'',order_count:1,total_cents:2200,last_order:objState.orders[1].created_at}
    ].filter(objCustomer=>`${objCustomer.email} ${objCustomer.last_name}`.toLowerCase().includes(strQuery));
  }
  const objStatusMatch=objUrl.pathname.match(/^\/api\/admin\/orders\/(\d+)$/);
  if (strMethod === 'PATCH' && objStatusMatch) {
    const objOrder=objState.orders.find(objItem=>objItem.id===objStatusMatch[1]);
    if(!objOrder)throw new Error('Demo order not found.');
    const strStatus=JSON.parse(objOptions.body||'{}').status;
    if(!canTransitionStatus(objOrder.status,strStatus))throw new Error('Choose an allowed next status for this demo order.');
    objOrder.status=strStatus;objOrder.updated_at=objNow.toISOString();
    return {status:strStatus};
  }
  const objEditMatch=objUrl.pathname.match(/^\/api\/admin\/orders\/(\d+)\/items$/);
  if(strMethod==='PATCH'&&objEditMatch){
    const objOrder=objState.orders.find(objItem=>objItem.id===objEditMatch[1]);
    if(!objOrder||!['received','preparing','ready'].includes(objOrder.status))throw new Error('Only current demo orders can be edited.');
    const arrItems=normalizeEditableItems(JSON.parse(objOptions.body||'{}').items,menuMap(objState)).map(objItem=>({kind:objItem.kind,description:objItem.description,quantity:objItem.quantity,unit_price_cents:objItem.unit}));
    if(!arrItems.length||arrItems.length>40)throw new Error('A demo order needs 1 to 40 items.');
    objOrder.items=arrItems;objOrder.total_cents=arrItems.reduce((nTotal,objItem)=>nTotal+objItem.quantity*objItem.unit_price_cents,0);objOrder.updated_at=objNow.toISOString();
    return {items:arrItems.map(objItem=>({kind:objItem.kind,description:objItem.description,quantity:objItem.quantity,unit:objItem.unit_price_cents})),totalCents:objOrder.total_cents};
  }
  throw new Error('Unsupported demo staff request.');
}
