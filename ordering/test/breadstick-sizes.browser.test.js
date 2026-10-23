import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const strHtml=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
test('breadsticks use the shared side quantity controls and have no size selector',()=>{
 assert.match(strHtml,/id="sides-list"/);
 assert.match(strHtml,/side-quantity-input/);
 assert.doesNotMatch(strHtml,/id="breadstick-size"|id="breadstick-size-template"/);
 assert.match(strHtml,/name:\`\$\{objSide\.name\} × \$\{objSide\.quantity\}\`/);
});
