import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';

// Opt in with RUN_BROWSER_TEST=1 and a locally installed Playwright/browser.
// This isolated HTTP fixture never connects to the production API or database.
test('menu dashboard browser workflows and keyboard access',{skip:process.env.RUN_BROWSER_TEST!=='1',timeout:90000},async objTest=>{
 const fnRequire=createRequire(import.meta.url);
 const {chromium:objChromium}=fnRequire(process.env.PLAYWRIGHT_MODULE||'playwright');
 const arrSeed=[
  {category:'pizza',name:'Small',description:'Classic pizza',price_cents:1000,is_active:1},
  {category:'topping',name:'Pepperoni',description:'Spicy slices',price_cents:150,is_active:1},
  {category:'side',name:'Breadsticks',description:'Fresh bread',price_cents:500,is_active:1},
  {category:'drink',name:'Small',description:'Small cup',price_cents:200,is_active:1},
  {category:'drink_name',name:'Water',description:'Still water',price_cents:0,is_active:1},
  {category:'side',name:'Old Side',description:'No longer served',price_cents:400,is_active:0},
 ];
 const strHtml=await readFile(new URL('../public/admin.html',import.meta.url),'utf8');
 const mapModules=new Map(await Promise.all(['admin-demo.js','admin-model.js','domain.js','validation.js'].map(async strName=>['/'+strName,await readFile(new URL('../'+strName,import.meta.url),'utf8')])));
 let arrRows=[],arrWrites=[],nFailStatus=0,bDelayDelete=false,fnReleaseDelete;
 const arrPageErrors=[];
 const objServer=createServer(async(objRequest,objResponse)=>{
  try{
   const objUrl=new URL(objRequest.url,'http://localhost');
   const send=(nStatus,objData)=>{objResponse.writeHead(nStatus,{'Content-Type':'application/json'});objResponse.end(JSON.stringify(objData));};
   if(objUrl.pathname==='/admin'){objResponse.writeHead(200,{'Content-Type':'text/html'});return objResponse.end(strHtml);}
   if(mapModules.has(objUrl.pathname)){objResponse.writeHead(200,{'Content-Type':'text/javascript'});return objResponse.end(mapModules.get(objUrl.pathname));}
   if(objUrl.pathname==='/api/menu')return send(200,arrRows.filter(objRow=>objRow.is_active));
   if(objUrl.pathname==='/api/admin/menu'&&objRequest.method==='GET')return send(200,arrRows);
   if(objUrl.pathname.startsWith('/api/admin/menu')){
    let strBody='';for await(const bufPart of objRequest)strBody+=bufPart;
    const objInput=JSON.parse(strBody);arrWrites.push({method:objRequest.method,path:objUrl.pathname,input:objInput});
    if(nFailStatus){const nStatus=nFailStatus;nFailStatus=0;return send(nStatus,{error:'Menu update failed. Please retry.'});}
    if(objRequest.method==='POST'){
     const objRow={category:objInput.category,name:objInput.name,description:objInput.description,price_cents:objInput.priceCents,is_active:1};arrRows.push(objRow);return send(201,objRow);
    }
    const [,strCategory,strName]=objUrl.pathname.match(/^\/api\/admin\/menu\/([^/]+)\/(.+)$/)||[];
    const objRow=arrRows.find(objItem=>objItem.category===strCategory&&objItem.name===decodeURIComponent(strName)&&objItem.is_active);
    if(!objRow)return send(404,{error:'Active menu item not found.'});
    if(objRequest.method==='PATCH'){Object.assign(objRow,{name:objInput.name,description:objInput.description,price_cents:objInput.priceCents});return send(200,objRow);}
    if(objRequest.method==='DELETE'){
     if(objInput.confirmation!=='DELETE '+objRow.name)return send(422,{error:'Type the exact confirmation.'});
     if(bDelayDelete)await new Promise(fnResolve=>{fnReleaseDelete=fnResolve;});
     objRow.is_active=0;return send(200,{name:objRow.name,is_active:0});
    }
   }
   if(objUrl.pathname.startsWith('/api/'))return send(200,[]);
   send(404,{error:'Not found'});
  }catch{objResponse.writeHead(500);objResponse.end();}
 });
 await new Promise(fnResolve=>objServer.listen(0,'127.0.0.1',fnResolve));
 let objBrowser;
 try{
  objBrowser=await objChromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  const strBase=`http://127.0.0.1:${objServer.address().port}`;
  async function openPage(objViewport={width:1280,height:900}){
   arrRows=structuredClone(arrSeed);arrWrites=[];nFailStatus=0;bDelayDelete=false;fnReleaseDelete=undefined;
   const objPage=await objBrowser.newPage({viewport:objViewport});
   objPage.setDefaultTimeout(7000);
   objPage.on('pageerror',objError=>arrPageErrors.push(objError.message));
   await objPage.route('https://**',objRoute=>objRoute.abort());
   await objPage.goto(strBase+'/admin?tab=menu');
   try{await objPage.getByText('5 active items; 1 removed.',{exact:true}).waitFor();}
   catch(objError){throw Error('Menu did not load: '+arrPageErrors.join('; ')+'; '+await objPage.locator('body').innerText(),{cause:objError});}
   return objPage;
  }
  async function openDelete(objPage,strName='Pepperoni',strCategory='Topping'){
   await objPage.getByRole('button',{name:`Delete ${strName} (${strCategory})`,exact:true}).click();
   await objPage.getByRole('dialog',{name:'Delete menu item',exact:true}).waitFor();
  }
  const deleteWrites=()=>arrWrites.filter(objWrite=>objWrite.method==='DELETE');

  await objTest.test('active and removed lists, description fields, safe text and edit focus',async()=>{
   const objPage=await openPage();
   try{
    if(process.env.MENU_SCREENSHOT_DIR)await objPage.screenshot({path:join(process.env.MENU_SCREENSHOT_DIR,'menu-desktop.png'),fullPage:true});
    assert.equal(await objPage.getByText('Old Side',{exact:true}).count(),0);
    await objPage.getByLabel('Show removed items').check();
    const objRemoved=objPage.getByRole('row').filter({has:objPage.getByText('Old Side',{exact:true})});
    assert.equal(await objRemoved.getByRole('button').count(),0);assert.equal(await objRemoved.getByText('Removed',{exact:true}).count(),1);
    const objAddForm=objPage.locator('#add-menu-form');
    await objAddForm.getByLabel('Item type').fill('Side');
    await objAddForm.getByLabel('Item name',{exact:true}).fill('Garlic Knots');
    await objAddForm.getByLabel('Description (optional)',{exact:true}).fill('<img src=x onerror="alert(1)"> Fresh garlic');
    await objAddForm.getByLabel('Price (dollars)',{exact:true}).fill('7.25');
    await objPage.getByRole('button',{name:'Add item',exact:true}).click();
    await objPage.getByText('Menu item added.',{exact:true}).first().waitFor();
    assert.equal(arrWrites[0].input.priceCents,725);assert.match(arrWrites[0].input.description,/Fresh garlic/);
    assert.equal(await objPage.locator('#menu-rows img').count(),0);
    await objPage.getByRole('button',{name:'Edit Garlic Knots (Side)',exact:true}).click();
    const objDialog=objPage.getByRole('dialog',{name:'Edit side',exact:true});
    assert.equal(await objDialog.getByLabel('Description (optional)').inputValue(),arrWrites[0].input.description);
    await objDialog.getByLabel('Item name').fill('Garlic Bites');
    await objDialog.getByLabel('Description (optional)').fill('Roasted garlic');
    await objDialog.getByLabel('Price (dollars)').fill('8.10');
    await objDialog.getByRole('button',{name:'Save changes'}).click();
    await objDialog.waitFor({state:'hidden'});
    await objPage.getByRole('button',{name:'Edit Garlic Bites (Side)',exact:true}).waitFor();
    assert.equal(arrWrites[1].input.priceCents,810);assert.equal(arrWrites[1].input.description,'Roasted garlic');
    assert.equal(await objPage.locator(':focus').getAttribute('aria-label'),'Edit Garlic Bites (Side)');
   }finally{await objPage.close();}
  });

  await objTest.test('exact two-step confirmation sends nothing before final submission',async()=>{
   const objPage=await openPage();
   try{
    await openDelete(objPage);
    assert.equal(await objPage.locator('#menu-delete-warning').textContent(),'Are you certain you want to delete this item? The item will be removed from the menu.');
    assert.equal(await objPage.locator('#menu-delete-phrase').textContent(),'DELETE Pepperoni');
    assert.equal(await objPage.locator('#menu-delete-second-step').isVisible(),false);
    assert.equal(await objPage.locator(':focus').getAttribute('id'),'cancel-menu-delete-first');
    await objPage.keyboard.press('Shift+Tab');assert.equal(await objPage.locator(':focus').getAttribute('id'),'confirm-menu-delete-yes');
    await objPage.keyboard.press('Enter');
    assert.equal(await objPage.locator(':focus').getAttribute('id'),'menu-delete-confirmation');
    const objInput=objPage.getByLabel('Confirmation phrase'),objSubmit=objPage.getByRole('button',{name:'Delete item',exact:true});
    assert.equal(await objSubmit.isDisabled(),true);assert.equal(deleteWrites().length,0);
    for(const strText of ['DELETE [item name]','delete Pepperoni','DELETE pepperoni','DELETE Pepperoni ',' DELETE Pepperoni']){
     await objInput.fill(strText);assert.equal(await objSubmit.isDisabled(),true);
    }
    await objPage.locator('#menu-delete-form').dispatchEvent('submit');assert.equal(deleteWrites().length,0);
    await objInput.fill('');await objPage.keyboard.type('DELETE Pepperoni');assert.equal(await objSubmit.isEnabled(),true);
    await objPage.keyboard.press('Backspace');assert.equal(await objSubmit.isDisabled(),true);
    await objPage.keyboard.type('i');await objPage.keyboard.press('Enter');
    await objPage.locator('#menu-delete-dialog').waitFor({state:'hidden'});
    await objPage.getByText('Pepperoni removed from the menu. Past orders are unchanged.',{exact:true}).first().waitFor();
    assert.equal(deleteWrites().length,1);assert.deepEqual(deleteWrites()[0].input,{confirmation:'DELETE Pepperoni'});
    assert.equal(arrRows.find(objRow=>objRow.name==='Pepperoni').is_active,0);assert.equal(arrRows.length,6);
    assert.equal(await objPage.getByRole('button',{name:'Delete Pepperoni (Topping)',exact:true}).count(),0);
    assert.equal(await objPage.locator(':focus').getAttribute('id'),'refresh-menu');
   }finally{await objPage.close();}
  });

  await objTest.test('Cancel and Escape clear confirmation and restore the invoking button',async()=>{
   const objPage=await openPage();
   try{
    await objPage.getByRole('button',{name:'Edit Pepperoni (Topping)',exact:true}).click();
    await objPage.locator('#menu-edit-dialog').getByLabel('Item name').fill('Unsaved name');
    await objPage.keyboard.press('Escape');
    assert.equal(await objPage.locator(':focus').getAttribute('aria-label'),'Edit Pepperoni (Topping)');
    assert.equal(arrWrites.length,0);
    await openDelete(objPage);await objPage.keyboard.press('Escape');
    assert.equal(await objPage.locator(':focus').getAttribute('aria-label'),'Delete Pepperoni (Topping)');
    await openDelete(objPage);await objPage.getByRole('button',{name:'Yes',exact:true}).click();
    await objPage.getByLabel('Confirmation phrase').fill('DELETE Pepperoni');
    await objPage.getByRole('button',{name:'Cancel',exact:true}).click();
    await openDelete(objPage,'Breadsticks','Side');
    assert.equal(await objPage.locator('#menu-delete-phrase').textContent(),'DELETE Breadsticks');
    await objPage.getByRole('button',{name:'Yes',exact:true}).click();
    assert.equal(await objPage.getByLabel('Confirmation phrase').inputValue(),'');
    assert.equal(await objPage.getByRole('button',{name:'Delete item',exact:true}).isDisabled(),true);
    await objPage.keyboard.press('Escape');assert.equal(deleteWrites().length,0);
    assert.equal(await objPage.locator(':focus').getAttribute('aria-label'),'Delete Breadsticks (Side)');
   }finally{await objPage.close();}
  });

  await objTest.test('price validation allows a zero drink adjustment but blocks invalid item prices',async()=>{
   const objPage=await openPage();
   try{
    const objForm=objPage.locator('#add-menu-form');
    await objForm.getByLabel('Item type').fill('Side');
    await objForm.getByLabel('Item name',{exact:true}).fill('Knots');
    for(const strPrice of ['0','1.005','10000.01']){
     await objForm.getByLabel('Price (dollars)',{exact:true}).fill(strPrice);
     await objPage.getByRole('button',{name:'Add item',exact:true}).click();
     assert.equal(arrWrites.length,0);
    }
    await objForm.getByLabel('Item type').fill('Drink');
    await objForm.getByLabel('Item name',{exact:true}).fill('Lemon Soda');
    await objForm.getByLabel('Price (dollars)',{exact:true}).fill('0');
    await objPage.getByRole('button',{name:'Add item',exact:true}).click();
    await objPage.getByRole('button',{name:'Edit Lemon Soda (Drink)',exact:true}).waitFor();
    assert.equal(arrWrites.length,1);assert.equal(arrWrites[0].input.priceCents,0);
   }finally{await objPage.close();}
  });

  await objTest.test('failed deletion retains the item and phrase; pending submission cannot double-send',async()=>{
   const objPage=await openPage();
   try{
    await openDelete(objPage);await objPage.getByRole('button',{name:'Yes',exact:true}).click();
    await objPage.getByLabel('Confirmation phrase').fill('DELETE Pepperoni');nFailStatus=503;
    await objPage.getByRole('button',{name:'Delete item',exact:true}).click();
    await objPage.getByText('Menu update failed. Please retry.',{exact:true}).waitFor();
    assert.equal(await objPage.getByLabel('Confirmation phrase').inputValue(),'DELETE Pepperoni');
    assert.equal(arrRows.find(objRow=>objRow.name==='Pepperoni').is_active,1);
    bDelayDelete=true;await objPage.getByRole('button',{name:'Delete item',exact:true}).click();
    await objPage.waitForFunction(()=>document.getElementById('menu-delete-form').getAttribute('aria-busy')==='true');
    await objPage.locator('#menu-delete-form').dispatchEvent('submit');
    await objPage.keyboard.press('Escape');assert.equal(await objPage.locator('#menu-delete-dialog').isVisible(),true);
    assert.equal(await objPage.getByRole('button',{name:'Cancel',exact:true}).isDisabled(),true);
    for(let nAttempt=0;!fnReleaseDelete&&nAttempt<100;nAttempt++)await new Promise(fnResolve=>setTimeout(fnResolve,10));
    assert.equal(deleteWrites().length,2);fnReleaseDelete();
    await objPage.locator('#menu-delete-dialog').waitFor({state:'hidden'});
   }finally{fnReleaseDelete?.();await objPage.close();}
  });

  await objTest.test('mobile layout stays within the viewport and confirmation is labelled',async()=>{
   const objPage=await openPage({width:390,height:844});
   try{
    assert.equal(await objPage.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    if(process.env.MENU_SCREENSHOT_DIR)await objPage.screenshot({path:join(process.env.MENU_SCREENSHOT_DIR,'menu-mobile.png'),fullPage:true});
    await objPage.locator('#menu-table-scroll').focus();await objPage.keyboard.press('ArrowRight');
    await objPage.waitForFunction(()=>document.getElementById('menu-table-scroll').scrollLeft>0);
    await openDelete(objPage);await objPage.getByRole('button',{name:'Yes',exact:true}).click();
    const objBox=await objPage.locator('#menu-delete-dialog').boundingBox();assert.ok(objBox.x>=0&&objBox.x+objBox.width<=390);
    assert.equal(await objPage.getByLabel('Confirmation phrase').count(),1);
    if(process.env.MENU_SCREENSHOT_DIR)await objPage.screenshot({path:join(process.env.MENU_SCREENSHOT_DIR,'menu-confirmation-mobile.png')});
    await objPage.keyboard.press('Escape');
   }finally{await objPage.close();}
  });
  assert.deepEqual(arrPageErrors,[]);
 }finally{
  fnReleaseDelete?.();await objBrowser?.close();
  await new Promise(fnResolve=>objServer.close(fnResolve));
 }
});
