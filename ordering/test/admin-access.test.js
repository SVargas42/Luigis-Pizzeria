import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requiresStaffAuthentication} from '../admin-access.js';

test('only the explicit demo staff page skips Basic authentication',()=>{
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/admin?demo=1&tab=current')),false);
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/admin/analytics?demo=1&tab=ordering')),false);
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/admin?tab=current')),true);
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/admin/analytics?tab=ordering')),true);
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/api/admin/analytics?view=today&demo=1')),true);
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/api/admin/orders?bucket=current')),true);
 assert.equal(requiresStaffAuthentication(new URL('https://example.test/admin-demo.js')),false);
});
