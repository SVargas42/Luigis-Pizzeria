import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const strHtml=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
const strMenuScript=strHtml.slice(strHtml.indexOf('    const objMenuLabels='),strHtml.indexOf('    function renderChart('));

async function createFixture(){
 const mapElements=new Map(),arrRequests=[];
 const arrRows=[{category:'dessert',name:'Brownie',description:'Chocolate',price_cents:400,is_active:1}];
 let bDeleteFails=false,bReloadFails=false;
 function createElement(){return {children:[],handlers:{},value:'',disabled:false,hidden:false,open:false,
  append(...arrChildren){this.children.push(...arrChildren);},replaceChildren(){this.children=[];},
  setAttribute(strName,strValue){this[strName]=strValue;},removeAttribute(strName){delete this[strName];},setCustomValidity(){},
  addEventListener(strEvent,fnHandler){this.handlers[strEvent]=fnHandler;},focus(){},
  showModal(){this.open=true;},close(){this.open=false;this.handlers.close?.();},reportValidity(){return true;}};}
 function getElement(strId){if(!mapElements.has(strId))mapElements.set(strId,createElement());return mapElements.get(strId);}
 const objContext={document:{createElement,getElementById:getElement},$:getElement,
  money:nPrice=>'$'+(nPrice/100).toFixed(2),announce(){},buildMenuChoices:async()=>{},
  textElement(strTag,strText,strClass){const objElement=createElement();objElement.textContent=strText;objElement.className=strClass;return objElement;},
  api:async(strPath,objOptions)=>{
   if(!objOptions){if(bReloadFails)throw Error('Refresh unavailable');return structuredClone(arrRows);}
   arrRequests.push({strPath,...objOptions});
   if(objOptions.method==='DELETE'){if(bDeleteFails)throw Error('Removal failed');arrRows[0].is_active=0;return {is_active:0};}
   return {};
  }};
 vm.runInNewContext(strMenuScript,objContext);await objContext.loadMenu();
 return {getElement,arrRequests,objContext,setDeleteFails:bValue=>{bDeleteFails=bValue;},setReloadFails:bValue=>{bReloadFails=bValue;},
  async submit(){await getElement('menu-delete-form').handlers.submit({preventDefault(){}});},
  open(){getElement('menu-rows').children[0].children.at(-1).children[0].children[1].handlers.click();}};
}

test('custom types appear in suggestions and edit/delete labels without HTML injection',async()=>{
 assert.match(strHtml,/<input id="new-menu-category"[^>]*list="menu-category-options"/);
 const objFixture=await createFixture();
 const arrOptions=objFixture.getElement('menu-category-options').children;
 assert.ok(arrOptions.some(objOption=>objOption.value==='Dessert'));
 assert.ok(arrOptions.some(objOption=>objOption.value==='Drink'));
 assert.equal(arrOptions.some(objOption=>objOption.value==='drink_name'),false);
 assert.equal(arrOptions.some(objOption=>objOption.textContent),false);
 const objActions=objFixture.getElement('menu-rows').children[0].children.at(-1).children[0].children;
 objActions[0].handlers.click();
 assert.equal(objFixture.getElement('menu-edit-title').textContent,'Edit dessert');
 assert.match(objActions[1]['aria-label'],/Brownie/);
});

test('friendly categories map to existing keys and new types submit canonical keys',async()=>{
 const objFixture=await createFixture();
 for(const [strLabel,strKey] of [['Pizza size','pizza'],['Topping','topping'],['Side','side'],['Drink','drink_name'],['Drink size','drink'],['Gluten Free','gluten_free']]){
  assert.equal(objFixture.objContext.menuCategoryKey(strLabel),strKey);
 }
 objFixture.getElement('new-menu-category').value='Drink';
 objFixture.getElement('new-menu-category').handlers.input();
 assert.equal(objFixture.getElement('new-menu-price').min,'0');
 objFixture.getElement('new-menu-category').value='Gluten Free';
 objFixture.getElement('new-menu-category').handlers.input();
 assert.equal(objFixture.getElement('new-menu-price').min,'0.01');
 objFixture.getElement('new-menu-name').value='Roll';
 objFixture.getElement('new-menu-price').value='4.00';
 await objFixture.getElement('add-menu-form').handlers.submit({preventDefault(){}});
 assert.equal(JSON.parse(objFixture.arrRequests[0].body).category,'gluten_free');
});

test('delete requires Yes and exact name, then removes row even if refresh fails',async()=>{
 const objFixture=await createFixture();objFixture.open();
 assert.equal(objFixture.getElement('menu-delete-phrase').textContent,'DELETE Brownie');
 await objFixture.submit();assert.equal(objFixture.arrRequests.length,0);
 objFixture.getElement('confirm-menu-delete-yes').handlers.click();
 for(const strPhrase of ['DELETE [item name]','DELETE brownie','DELETE Brownie ']){
  objFixture.getElement('menu-delete-confirmation').value=strPhrase;
  objFixture.getElement('menu-delete-confirmation').handlers.input();
  assert.equal(objFixture.getElement('submit-menu-delete').disabled,true);
  await objFixture.submit();assert.equal(objFixture.arrRequests.length,0);
 }
 objFixture.getElement('menu-delete-confirmation').value='DELETE Brownie';
 objFixture.getElement('menu-delete-confirmation').handlers.input();
 assert.equal(objFixture.getElement('submit-menu-delete').disabled,false);
 objFixture.setReloadFails(true);await objFixture.submit();
 assert.equal(objFixture.arrRequests.length,1);
 assert.equal(objFixture.arrRequests[0].strPath,'/api/admin/menu/dessert/Brownie');
 assert.deepEqual(JSON.parse(objFixture.arrRequests[0].body),{confirmation:'DELETE Brownie'});
 assert.equal(objFixture.getElement('menu-rows').children[0].children[0].textContent,'No menu items to show.');
});

test('failed deletion preserves row and allows retry',async()=>{
 const objFixture=await createFixture();objFixture.open();
 objFixture.getElement('confirm-menu-delete-yes').handlers.click();
 objFixture.getElement('menu-delete-confirmation').value='DELETE Brownie';
 objFixture.getElement('menu-delete-confirmation').handlers.input();objFixture.setDeleteFails(true);
 await objFixture.submit();
 assert.equal(objFixture.getElement('menu-delete-dialog').open,true);
 assert.equal(objFixture.getElement('menu-delete-message').textContent,'Removal failed');
 assert.equal(objFixture.getElement('menu-rows').children[0].children[1].textContent,'Brownie');
 assert.equal(objFixture.getElement('submit-menu-delete').disabled,false);
 objFixture.setDeleteFails(false);await objFixture.submit();
 assert.equal(objFixture.getElement('menu-delete-dialog').open,false);
});
