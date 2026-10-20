import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const strHtml=readFileSync(new URL('../public/account.html',import.meta.url),'utf8');
const strScript=readFileSync(new URL('../public/account.js',import.meta.url),'utf8');

test('account actions follow the primary form and phone inputs stay short and formatted',()=>{
 assert.ok(strHtml.indexOf('</form>')<strHtml.indexOf('<nav aria-label="Account actions">'));
 assert.ok(!strHtml.includes('>Profile</a>'));
 for(const strId of ['phone','invite-phone']){const strInput=strHtml.match(new RegExp(`<input[^>]*id="${strId}"[^>]*>`))?.[0]||'';assert.ok(strInput.includes('maxlength="14"'));assert.ok(strInput.includes('pattern='));}
 assert.ok(strHtml.includes('.phone-control{max-width:260px}'));
 new vm.Script(strScript);
 assert.ok(strScript.includes("reportValidity()"));
});
