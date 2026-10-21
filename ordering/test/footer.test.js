import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('public pages provide native keyboard-accessible ingredient, payment and privacy disclosures',()=>{
 for(const strPath of ['../../index.html','../public/account.html','../public/tracker.html']){
  const strHtml=readFileSync(new URL(strPath,import.meta.url),'utf8');
  for(const strId of ['allergen-information','ordering-information','refund-policy','privacy-information'])assert.ok(strHtml.includes(`<details id="${strId}"><summary>`),strPath+': '+strId);
  assert.match(strHtml,/<footer[^>]*aria-label="Restaurant information"/);
  assert.ok(strHtml.includes('sesame')&&strHtml.includes('cross-contact'));
  assert.ok(!strHtml.includes('allergen-free guarantee'));
  assert.ok(strHtml.includes('tel:+19313723122')&&strHtml.includes('mailto:l7163747@gmail.com'));
  assert.ok(strHtml.includes('Cookeville, Tennessee'));
  assert.ok(strHtml.includes('original payment method')&&strHtml.includes('within 24 hours'));
  const strFooter=strHtml.match(/<footer[\s\S]*?<\/footer>/)[0];
  assert.ok(!/this is an example|placeholder/i.test(strFooter));
 }
});
