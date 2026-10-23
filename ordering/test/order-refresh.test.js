import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const strHtml=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
const strLoad=strHtml.slice(strHtml.indexOf('    const mapOrderSnapshots='),strHtml.indexOf('    async function changeStatus('));
const strHandlers=strHtml.slice(strHtml.indexOf("    document.querySelectorAll('[data-refresh]')"),strHtml.indexOf('    async function loadCustomers('));

function fixture(){
 const arrRequests=[],arrAnnouncements=[],mapElements=new Map(),mapTimers=new Map();
 let nTimerId=0,fnFinish;
 function element(){return {textContent:'Refresh orders',disabled:false,children:[],handlers:{},
  setAttribute(strKey,strValue){this[strKey]=strValue;},removeAttribute(strKey){delete this[strKey];},
  addEventListener(strEvent,fnHandler){this.handlers[strEvent]=fnHandler;},
  replaceChildren(){this.children=[];},append(objChild){this.children.push(objChild);}};}
 function getElement(strId){if(!mapElements.has(strId))mapElements.set(strId,element());return mapElements.get(strId);}
 const arrButtons=['current','past'].map(strBucket=>Object.assign(element(),{dataset:{refresh:strBucket}}));
 const objContext={document:{querySelectorAll:()=>arrButtons},$:getElement,bDemoMode:false,
  api:strPath=>{arrRequests.push(strPath);return new Promise((fnResolve,fnReject)=>{fnFinish=bSuccess=>bSuccess?fnResolve([]):fnReject(Error('Refresh unavailable'));});},
  textElement:(strTag,strText)=>({textContent:strText}),announce:(...arrValues)=>arrAnnouncements.push(arrValues),
  setTimeout(fnCallback,nDelay){const nId=++nTimerId;mapTimers.set(nId,{fnCallback,nDelay});return nId;},
  clearTimeout:nId=>mapTimers.delete(nId)};
 vm.runInNewContext(strLoad+strHandlers,objContext);
 return {arrButtons,arrRequests,arrAnnouncements,mapTimers,getElement,finish:bSuccess=>fnFinish(bSuccess)};
}

for(const [nIndex,strPath] of [[0,'/api/employee/orders/active'],[1,'/api/admin/orders?bucket=past']]){
 test(`${nIndex===0?'Current':'Past'} orders show immediate loading and timed success feedback`,async()=>{
  const objFixture=fixture(),objButton=objFixture.arrButtons[nIndex];
  const objPending=objButton.handlers.click();
  assert.equal(objButton.textContent,'Refreshing...');assert.equal(objButton.disabled,true);
  assert.equal(objButton['aria-busy'],'true');assert.equal(objButton['aria-live'],'polite');
  assert.deepEqual(objFixture.arrRequests,[strPath]);
  await objButton.handlers.click();assert.equal(objFixture.arrRequests.length,1);
  objFixture.finish(true);await objPending;
  assert.equal(objButton.textContent,'Refreshed!');assert.equal(objButton.disabled,false);
  assert.equal(objButton['aria-busy'],undefined);
  const objTimer=[...objFixture.mapTimers.values()][0];assert.equal(objTimer.nDelay,2500);
  objTimer.fnCallback();assert.equal(objButton.textContent,'Refresh orders');
 });
 test(`${nIndex===0?'Current':'Past'} orders display errors without false success`,async()=>{
  const objFixture=fixture(),objButton=objFixture.arrButtons[nIndex];
  const objPending=objButton.handlers.click();objFixture.finish(false);await objPending;
  assert.equal(objButton.textContent,'Refresh failed');assert.equal(objButton.disabled,false);
  assert.deepEqual(objFixture.arrAnnouncements.at(-1),['Refresh unavailable',true]);
  [...objFixture.mapTimers.values()][0].fnCallback();assert.equal(objButton.textContent,'Refresh orders');
 });
}

test('a repeated refresh cancels its previous feedback timer',async()=>{
 const objFixture=fixture(),objButton=objFixture.arrButtons[0];
 let objPending=objButton.handlers.click();objFixture.finish(true);await objPending;
 assert.equal(objFixture.mapTimers.size,1);
 objPending=objButton.handlers.click();assert.equal(objFixture.mapTimers.size,0);
 objFixture.finish(true);await objPending;
 assert.equal(objFixture.mapTimers.size,1);
 [...objFixture.mapTimers.values()][0].fnCallback();assert.equal(objButton.textContent,'Refresh orders');
});
