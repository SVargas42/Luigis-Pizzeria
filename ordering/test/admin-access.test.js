import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requiresStaffAuthentication} from '../admin-access.js';

test('every staff page and API requires server-verified administrator access',()=>{
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/admin?demo=1&tab=current')),true);
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/admin/analytics?demo=1&tab=ordering')),true);
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/admin?tab=current')),true);
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/admin/analytics?tab=ordering')),true);
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/api/admin/analytics?view=today&demo=1')),true);
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/api/admin/orders?bucket=current')),true);
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/admin-demo.js')),false);
});
