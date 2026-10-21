import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('public pages provide native keyboard-accessible ingredient, payment and privacy disclosures',()=>{
 for(const strPath of ['../../index.html','../public/account.html','../public/tracker.html']){
  const strHtml=readFileSync(new URL(strPath,import.meta.url),'utf8');
  for(const strId of ['allergen-information','ordering-information','privacy-information'])assert.ok(strHtml.includes(`<details id="${strId}"><summary>`),strPath+': '+strId);
  assert.match(strHtml,/<footer[^>]*aria-label="Restaurant information"/);
  assert.ok(strHtml.includes('sesame')&&strHtml.includes('cross-contact'));
  assert.ok(!strHtml.includes('allergen-free guarantee'));
 }
});
