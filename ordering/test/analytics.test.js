import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateAnalytics} from '../analytics.js';
const objNow=new Date('2026-10-18T12:00:00Z');
const arrOrders=[{id:1,status:'completed',total_cents:1800,created_at:'2026-10-18T00:30:00Z'},{id:2,status:'cancelled',total_cents:9000,created_at:'2026-10-18T01:00:00Z'},{id:3,status:'received',total_cents:500,created_at:'2026-10-17T23:00:00Z'}];
const arrItems=[{order_id:1,kind:'pizza',description:'Small pizza with Cheese',quantity:2},{order_id:2,kind:'pizza',description:'Large pizza',quantity:8},{order_id:3,kind:'side',description:'Breadsticks',quantity:1}];
test('analytics use actual quantities, UTC dates, exclude cancelled orders and zero-fill dates',()=>{
 const objData=calculateAnalytics(arrOrders,arrItems,[],[],objNow);
 assert.equal(objData.ordering('today').metric,2);assert.equal(objData.business.salesTodayCents,1800);assert.equal(objData.business.ordersToday,1);assert.equal(objData.business.cancellationRate,50);
 assert.equal(objData.ordering('average').points.length,30);assert.equal(objData.ordering('average').points[0].value,0);assert.equal(objData.ordering('average').metric,0.1);
 assert.equal(objData.products('topping:Cheese','pizza:Large','week').series[0].values.at(-1),2);assert.equal(objData.products('topping:Cheese','pizza:Large','week').series[1].values.at(-1),0);
 assert.equal(objData.employees.employees.length,0);assert.equal(objData.business.synthetic,false);assert.throws(()=>objData.ordering('future'));assert.throws(()=>objData.products('pizza:Small','pizza:Large','future'));
});
test('empty database reports zero order activity instead of generated sales',()=>{
 const objData=calculateAnalytics([],[],[],[],objNow);assert.equal(objData.business.averageOrderCents,0);assert.equal(objData.ordering('monthly').points.length,6);assert.equal(objData.ordering('monthly').metric,0);assert.equal(objData.business.weeklySales.length,7);assert.equal(objData.business.cancellationRate,0);
});
test('staff attribution counts distinct touched orders without inventing shift hours',()=>{
 const arrEvents=[{order_id:1,actor_email:'staff@example.com',event_type:'status_changed',created_at:'2026-10-18T02:00:00Z'},{order_id:1,actor_email:'staff@example.com',event_type:'status_changed',created_at:'2026-10-18T03:00:00Z'},{order_id:2,actor_email:null,event_type:'status_changed',created_at:'2026-10-18T03:00:00Z'}];
 const objData=calculateAnalytics(arrOrders,arrItems,arrEvents,[{role:'admin',email:'staff@example.com',first_name:'Ada',last_name:'Admin'}],objNow);assert.equal(objData.employees.employees[0].ordersToday,1);assert.equal(objData.employees.employees[0].hoursToday,null);
});
test('card totals include cancelled-but-not-refunded charges and separate refunds from order value',()=>{
 const arrCards=[{id:1,status:'cancelled',total_cents:2000,created_at:'2026-10-18T01:00:00Z',payment_method:'online',payment_status:'paid',refunded_cents:0},{id:2,status:'completed',total_cents:1500,created_at:'2026-10-18T02:00:00Z',payment_method:'online',payment_status:'partially_refunded',refunded_cents:500}];
 const objData=calculateAnalytics(arrCards,[],[],[],objNow);assert.equal(objData.business.paidCardCents,3000);assert.equal(objData.business.refundedCardCents,500);assert.equal(objData.business.salesTodayCents,1500);
});
test('product analytics can compare a drink flavor across sizes and a drink size across flavors',()=>{
 const arrDrinkItems=[...arrItems,{order_id:1,kind:'drink',description:'Coke (Small)',quantity:2},{order_id:1,kind:'drink',description:'Coke (Large)',quantity:1},{order_id:1,kind:'drink',description:'Pepsi (Large)',quantity:3}];
 const objProducts=calculateAnalytics(arrOrders,arrDrinkItems,[],[],objNow).products;
 assert.equal(objProducts('drink:Coke','topping:Cheese','week').series[0].values.at(-1),3);
 assert.equal(objProducts('drink-size:Large','topping:Cheese','week').series[0].values.at(-1),4);
 assert.throws(()=>objProducts('beverage:Coke','pizza:Small','week'));
});

test('pizza outlook contains 30 future daily points and does not alter recorded metrics',()=>{
 const objData=calculateAnalytics(arrOrders,arrItems,[],[],objNow),objForecast=objData.ordering('forecast');
 assert.equal(objForecast.points.length,30);assert.equal(objForecast.title,'Pizza forecast · next 30 days');
 assert.ok(objForecast.points.every(objPoint=>objPoint.label>objData.business.asOf&&Number.isFinite(objPoint.value)&&objPoint.value>=0));
 assert.equal(objData.ordering('today').metric,2);
});
