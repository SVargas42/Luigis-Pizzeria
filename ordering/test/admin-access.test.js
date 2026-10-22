import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requiresStaffAuthentication,canAccessStaffRoute} from '../admin-access.js';

test('every staff page and API requires server-verified administrator access',()=>{
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/admin?demo=1&tab=current')),true);
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/admin/analytics?demo=1&tab=ordering')),true);
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/admin?tab=current')),true);
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/admin/analytics?tab=ordering')),true);
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/api/admin/analytics?view=today&demo=1')),true);
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/api/admin/orders?bucket=current')),true);
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/admin-demo.js')),false);
});

test('worker permission allowlist permits kitchen operations and denies all management access',()=>{
 const arrAllowed=[['GET','/staff'],['GET','/api/employee/orders/active'],['PATCH','/api/employee/orders/7/status'],['PATCH','/api/employee/orders/7/estimate'],['POST','/api/employee/orders/7/complete']];
 for(const [strMethod,strPath] of arrAllowed){const objUrl=new URL(strPath,'https://pizza.example');assert.equal(requiresStaffAuthentication(objUrl),true);assert.equal(canAccessStaffRoute('worker',objUrl,strMethod),true);assert.equal(canAccessStaffRoute('admin',objUrl,strMethod),true);for(const strRole of ['customer',undefined,'owner'])assert.equal(canAccessStaffRoute(strRole,objUrl,strMethod),false);}
 const arrDenied=[['GET','/admin'],['GET','/admin/analytics'],['GET','/admin/accounts'],['GET','/api/admin/orders'],['GET','/api/admin/customers'],['GET','/api/admin/analytics'],['GET','/api/admin/menu'],['POST','/api/admin/accounts/invite'],['POST','/api/admin/accounts/update'],['DELETE','/api/admin/menu/side/Breadsticks'],['GET','/api/employee/orders/7/refund'],['POST','/api/employee/orders/7/status'],['PATCH','/api/employee/orders/7/complete'],['GET','/api/employee/new-management-feature']];
 for(const [strMethod,strPath] of arrDenied){const objUrl=new URL(strPath,'https://pizza.example');assert.equal(canAccessStaffRoute('worker',objUrl,strMethod),false,strMethod+' '+strPath);}
});
