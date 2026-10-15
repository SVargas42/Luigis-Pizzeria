import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDemoAdminState,handleDemoAdminRequest} from '../admin-demo.js';

const objNow=new Date('2026-10-15T18:00:00.000Z');
test('demo workspace returns only synthetic current and past orders with plausible timestamps',()=>{
 const objState=createDemoAdminState(objNow);
 const arrCurrent=handleDemoAdminRequest('/api/admin/orders?bucket=current',{},objState,objNow);
 const arrPast=handleDemoAdminRequest('/api/admin/orders?bucket=past',{},objState,objNow);
 assert.deepEqual(arrCurrent.map(objOrder=>objOrder.id),['DEMO-101','DEMO-102']);
 assert.deepEqual(arrPast.map(objOrder=>objOrder.id),['DEMO-099']);
 assert.equal(Date.parse(arrCurrent[0].created_at),objNow.getTime()-18*60*1000);
 assert.ok(arrCurrent.every(objOrder=>objOrder.customer_email.endsWith('.test')));
});

test('demo edits and status changes stay in the local demo state',()=>{
 const objState=createDemoAdminState(objNow);
 const objEdit=handleDemoAdminRequest('/api/admin/orders/DEMO-101/items',{method:'PATCH',body:JSON.stringify({items:[{kind:'pizza',description:'Large pizza with Cheese, Pepperoni',quantity:1},{kind:'side',description:'Breadsticks',quantity:2}]})},objState,objNow);
 assert.equal(objEdit.totalCents,1600+150+150+1000);
 assert.equal(objState.orders[0].total_cents,objEdit.totalCents);
 const objStatus=handleDemoAdminRequest('/api/admin/orders/DEMO-101',{method:'PATCH',body:JSON.stringify({status:'ready'})},objState,objNow);
 assert.deepEqual(objStatus,{status:'ready'});
 assert.equal(objState.orders[0].status,'ready');
});

test('demo workspace includes analytics and only sample customer entries',()=>{
 const objState=createDemoAdminState(objNow);
 assert.equal(handleDemoAdminRequest('/api/admin/analytics?view=today',{},objState,objNow).synthetic,true);
 assert.equal(handleDemoAdminRequest('/api/admin/analytics/products?left=pizza%3ASmall&right=drink%3APepsi+%28Large%29&period=week',{},objState,objNow).series.length,2);
 assert.equal(handleDemoAdminRequest('/api/admin/analytics/employees',{},objState,objNow).employees.length,4);
 assert.equal(handleDemoAdminRequest('/api/admin/analytics/business',{},objState,objNow).synthetic,true);
 const arrCustomers=handleDemoAdminRequest('/api/admin/customers?q=customer',{},objState,objNow);
 assert.deepEqual(arrCustomers.map(objCustomer=>objCustomer.email),['customer@example.test']);
});
