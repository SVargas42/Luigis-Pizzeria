import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const strHtml=readFileSync(new URL('../public/account.html',import.meta.url),'utf8');
const strScript=readFileSync(new URL('../public/account.js',import.meta.url),'utf8');

test('account actions follow the primary form and phone inputs stay short and formatted',()=>{
 assert.ok(strHtml.indexOf('</form>')<strHtml.indexOf('id="account-actions"'));
 assert.ok(!strHtml.includes('>Profile</a>'));
 for(const strId of ['phone','invite-phone']){const strInput=strHtml.match(new RegExp(`<input[^>]*id="${strId}"[^>]*>`))?.[0]||'';assert.ok(strInput.includes('maxlength="14"'));assert.ok(strInput.includes('pattern='));}
 assert.ok(strHtml.includes('.phone-control{max-width:260px}'));
 new vm.Script(strScript);
 assert.ok(strScript.includes("reportValidity()"));
});

test('profile offers locked email and only the requested three actions',()=>{
 const strEmail=strHtml.match(/<input[^>]*id="email"[^>]*>/)?.[0]||'';
 assert.ok(strEmail.includes('type="email"'));assert.ok(strHtml.includes('id="email-locked-help"'));assert.ok(strScript.includes("$('email').disabled=strMode==='profile'"));
 for(const strId of ['profile-actions','reset-password','logout'])assert.ok(strHtml.includes(`id="${strId}"`));
 assert.ok(strScript.includes("$('submit').textContent=strMode==='profile'?'Save':objTitles[strMode]"));
 assert.ok(strHtml.includes('.readonly-input:disabled{background:#e0ded9'));
 assert.ok(strScript.includes("$('profile-actions').hidden=strMode!=='profile'"));
});
test('account management begins at its focused Account Management heading',()=>{assert.ok(strHtml.includes('id="management-title" tabindex="-1">Account Management'));assert.ok(strScript.includes("$('account-home-link').hidden=true;$('account-actions').hidden=true"));});
test('account management includes the restored welcoming photo banner',()=>{assert.ok(strHtml.includes('class="management-banner"'));assert.ok(strHtml.includes('Luigi’s Pizza · Made with amore'));});
