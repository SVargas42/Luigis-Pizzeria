import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('account forms have labelled fields, required signup inputs and safe token handling',()=>{
 const strHtml=readFileSync(new URL('../public/account.html',import.meta.url),'utf8'),strCode=readFileSync(new URL('../public/account.js',import.meta.url),'utf8');new vm.Script(strCode);
 for(const strId of ['firstName','lastName','email','phone','password','currentPassword'])assert.ok(strHtml.includes(`for="${strId}"`));
 assert.match(strHtml,/role="status"/);assert.match(strHtml,/autocomplete="new-password"|id="password"/);assert.ok(strCode.includes('history.replaceState'));assert.ok(strCode.includes('location.hash.slice(1)'));assert.ok(strCode.includes("['firstName','lastName','phone']"));assert.ok(strCode.includes("$(strId).required=bProfile"));
});
test('mutating requests, including login and payments, enforce origin before route handlers',()=>{
 const strServer=readFileSync(new URL('../server.js',import.meta.url),'utf8');new vm.Script(strServer.replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',"'file:///server.js'"));
 assert.ok(strServer.indexOf("req.headers.origin!==new URL(process.env.SITE_URL).origin")<strServer.indexOf("url.pathname.startsWith('/api/auth/')"));
 assert.ok(strServer.indexOf("req.headers.origin!==new URL(process.env.SITE_URL).origin")<strServer.indexOf("'/api/stripe/checkout'"));
 assert.doesNotMatch(strServer,/\|\| authorized\(req\)/);assert.match(strServer,/JOIN account_order_claims/);assert.match(strServer,/account_id=\?/);assert.match(strServer,/loadAnalytics\(pool\)/);assert.doesNotMatch(strServer,/buildSynthetic/);
});
