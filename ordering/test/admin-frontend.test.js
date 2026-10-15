import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const strHtml=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
const strScript=strHtml.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];

test('staff screen script parses and includes all requested workspace tabs',()=>{
 assert.ok(strScript);
 new vm.Script(strScript.replace(/^ *import .*;\r?\n/gm,'').trim());
 for(const strTab of ['Current Orders','Past Orders','Ordering Analytics','Employee Data','Business Data','Customers'])assert.ok(strHtml.includes(strTab));
 assert.ok(strHtml.includes('aria-selected="true"'));
 assert.ok(strHtml.toLowerCase().includes('sample data only'));
 assert.ok(strScript.includes("get('demo')==='1'"));
 assert.ok(strScript.includes('handleDemoAdminRequest'));
 assert.ok(strHtml.includes('href="/admin/analytics?demo=1&tab=ordering"'));
 assert.ok(strHtml.includes('id="edit-items-editor"'));
 assert.ok(!strHtml.includes('id="edit-items"'));
});
