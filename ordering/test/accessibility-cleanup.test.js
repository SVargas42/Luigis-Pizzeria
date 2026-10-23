import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const strIndex=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const strAdmin=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
const strTracker=readFileSync(new URL('../public/tracker.html',import.meta.url),'utf8');
const strStaff=readFileSync(new URL('../public/staff.html',import.meta.url),'utf8');

function relativeLuminance(strHex){
 const arrLinear=strHex.match(/../g).map(strPair=>parseInt(strPair,16)/255)
  .map(nChannel=>nChannel<=0.04045?nChannel/12.92:((nChannel+0.055)/1.055)**2.4);
 return arrLinear.reduce((nTotal,nChannel,nIndex)=>nTotal+nChannel*[0.2126,0.7152,0.0722][nIndex],0);
}

test('form boundaries contrast with both white fields and cream surfaces',()=>{
 const strBorder=strIndex.match(/\.form-control,\.form-select\{border-color:#([a-f0-9]{6})/)[1];
 for(const strBackground of ['ffffff','fffefa','fbf7ef']){
  assert.ok((relativeLuminance(strBackground)+0.05)/(relativeLuminance(strBorder)+0.05)>=3);
 }
 assert.match(strIndex,new RegExp(`\\.form-check-input\\{border-color:#${strBorder}`));
 assert.ok(strAdmin.includes(`input,textarea,select{border:1px solid #${strBorder}`));
 assert.ok(strStaff.includes(`border:1px solid #${strBorder}`));
});

test('side quantities retain their accessible name and include their visible label',()=>{
 assert.match(strIndex,/<label class="side-quantity-label"><span>Quantity<\/span>/);
 assert.match(strIndex,/aria-label="Quantity of \$\{label\}"/);
});

test('pickup estimates announce updates without making whole order lists live',()=>{
 assert.match(strTracker,/<p id="tracker-estimate" role="status" aria-live="polite" aria-atomic="true">/);
 for(const strId of ['current-orders','past-orders']){
  assert.doesNotMatch(strAdmin,new RegExp(`<div[^>]*id="${strId}"[^>]*aria-live`));
 }
 assert.match(strAdmin,/id="message" role="status" aria-live="polite"/);
});

test('automatic order polling only redraws and announces changed results',async()=>{
 const strLoad=strAdmin.slice(strAdmin.indexOf('    const mapOrderSnapshots='),strAdmin.indexOf('    async function changeStatus('));
 let arrOrders=[],nRenders=0;
 const arrAnnouncements=[];
 const objContainer={contains:()=>false,replaceChildren(){nRenders++;},append(){}};
 const objContext={document:{},$:strId=>strId==='edit-dialog'?{open:false}:objContainer,
  bDemoMode:false,bOrderUpdatesPaused:false,api:async()=>arrOrders,
  textElement:()=>({}),renderOrder:()=>({}),announce:strMessage=>arrAnnouncements.push(strMessage)};
 vm.createContext(objContext);vm.runInContext(strLoad,objContext);
 await vm.runInContext("loadOrders('current')",objContext);
 await vm.runInContext("loadOrders('current',true)",objContext);
 assert.equal(nRenders,1);assert.equal(arrAnnouncements.length,1);
 arrOrders=[{id:7,tracking_status:'preparing_order'}];
 await vm.runInContext("loadOrders('current',true)",objContext);
 assert.equal(nRenders,2);assert.equal(arrAnnouncements.length,2);
 arrOrders=[{id:7,tracking_status:'cooking_order'}];
 await vm.runInContext("loadOrders('current',true)",objContext);
 assert.equal(nRenders,3);
 await vm.runInContext("loadOrders('current')",objContext);
 assert.equal(nRenders,4);
});
