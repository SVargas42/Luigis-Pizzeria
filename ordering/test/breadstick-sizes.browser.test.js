import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';

// An isolated fixture captures orders; no test orders reach the live server.
test('breadstick sizes, keyboard selection, totals, pickup payload and online guard',
 {skip:process.env.RUN_BROWSER_TEST!=='1',timeout:90000},async objTest=>{
 const {chromium:objChromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
 const strHtml=process.env.TEST_HTML_URL
  ? await (await fetch(process.env.TEST_HTML_URL)).text()
  : await readFile(new URL('../../index.html',import.meta.url),'utf8');
 const strStripe=await readFile(new URL('../public/stripe-checkout.js',import.meta.url),'utf8');
 const arrOrders=[],arrErrors=[];
 const arrMenu=[{category:'pizza',name:'Small',price_cents:1000},
  {category:'side',name:'Breadsticks',price_cents:500},
  {category:'side',name:'Pizza Bites',price_cents:600}];
 const objServer=createServer(async(objRequest,objResponse)=>{
  const strPath=new URL(objRequest.url,'http://localhost').pathname;
  const send=(objData)=>{objResponse.setHeader('Content-Type','application/json');objResponse.end(JSON.stringify(objData));};
  if(strPath==='/'){objResponse.setHeader('Content-Type','text/html');return objResponse.end(strHtml);}
  if(strPath==='/stripe-checkout.js'){objResponse.setHeader('Content-Type','text/javascript');return objResponse.end(strStripe);}
  if(strPath==='/api/menu')return send(arrMenu);
  if(strPath==='/api/session')return send({authenticated:false,authReady:true});
  if(strPath==='/api/stripe/config')return send({enabled:true});
  if(strPath==='/api/orders'){
   let strBody='';for await(const bufPart of objRequest)strBody+=bufPart;
   const objPayload=JSON.parse(strBody);arrOrders.push(objPayload);
   const objSide=objPayload.sides.find(objItem=>objItem.name==='Breadsticks');
   const nUnit={Small:400,Medium:500,Large:600}[objSide.size];
   return send({orderNumber:'LP-TEST',subtotalCents:1000+nUnit*objSide.quantity,
    taxCents:0,totalCents:1000+nUnit*objSide.quantity,paymentMethod:'in_store',paymentStatus:'unpaid',
    trackerUrl:'/track?token=test',items:[{description:`Breadsticks (${objSide.size})`,unit:nUnit,quantity:objSide.quantity}]});
  }
  objResponse.statusCode=404;objResponse.end();
 });
 await new Promise(fnResolve=>objServer.listen(0,'127.0.0.1',fnResolve));
 objTest.after(()=>new Promise(fnResolve=>objServer.close(fnResolve)));
 const objBrowser=await objChromium.launch({channel:'chrome',headless:true});
 objTest.after(()=>objBrowser.close());
 const objPage=await objBrowser.newPage();objPage.on('pageerror',objError=>arrErrors.push(objError.message));
 await objPage.route('**/*',objRoute=>new URL(objRoute.request().url()).hostname==='127.0.0.1'?objRoute.continue():objRoute.abort());
 const enterMenu=async(bAddBreadsticks=true)=>{
  await objPage.goto(`http://127.0.0.1:${objServer.address().port}/`);
  await objPage.locator('#start-order').click();
  for(const [strId,strValue] of [['firstName','Ada'],['lastName','Tester'],['email','ada@example.com'],['phone','5551234567']])await objPage.locator('#'+strId).fill(strValue);
  await objPage.locator('#customer-form button[type=submit]').click();
  await objPage.locator('#pizzas-container input[type=radio][value=Small]').check();
  if(bAddBreadsticks)await objPage.locator('.side-check[value=Breadsticks]').check();
 };
 for(const [strSize,nPrice] of [['Small',4],['Medium',5],['Large',6]]){
  await enterMenu(false);
  const objSelect=objPage.locator('#breadstick-size');
  assert.equal(await objSelect.isVisible(),true);
  assert.equal(await objSelect.isEnabled(),true);
  assert.equal(await objSelect.inputValue(),'Medium');
  assert.equal(await objSelect.evaluate(objElement=>objElement.labels[0].querySelector('span').textContent.trim()),'Size');
  assert.equal(await objSelect.evaluate(objElement=>objElement.labels[0].htmlFor), 'breadstick-size');
  await objSelect.focus();await objSelect.press('Home');
  if(strSize==='Medium')await objSelect.press('ArrowDown');
  if(strSize==='Large')await objSelect.press('End');
  assert.equal(await objSelect.inputValue(),strSize);
  assert.equal(await objPage.locator('.extra-row').filter({has:objPage.locator('.side-check[value=Breadsticks]')}).locator('.extra-price').textContent(),`$${nPrice.toFixed(2)} each`);
  assert.equal(await objPage.locator('.side-check[value=Breadsticks]').isChecked(),false);
  assert.equal(await objPage.locator('#menu-total').textContent(),'$10.00');
  await objPage.locator('.side-check[value="Pizza Bites"]').check();
  assert.equal(await objPage.locator('#breadstick-size').inputValue(),strSize);
  await objPage.locator('.side-check[value="Pizza Bites"]').uncheck();
  await objPage.locator('.side-check[value=Breadsticks]').check();
  assert.equal(await objPage.locator('#breadstick-size').inputValue(),strSize);
  await objPage.getByRole('spinbutton',{name:'Quantity of Breadsticks',exact:true}).fill('2');
  assert.equal(await objPage.locator('#menu-total').textContent(),`$${(10+nPrice*2).toFixed(2)}`);
  assert.match(await objPage.locator('#menu-summary-lines').textContent(),new RegExp(`Breadsticks \\(${strSize}\\)`));
  await objPage.locator('.side-check[value="Pizza Bites"]').check();
  assert.equal(await objPage.locator('#breadstick-size').inputValue(),strSize);
  await objPage.locator('.side-check[value="Pizza Bites"]').uncheck();
  await objPage.locator('#to-payment').click();await objPage.locator('#place-order').click();
  await objPage.locator('#order-number').filter({hasText:'LP-TEST'}).waitFor();
  assert.deepEqual(arrOrders.at(-1).sides,[{name:'Breadsticks',quantity:2,size:strSize}]);
 }
 await enterMenu();await objPage.locator('#breadstick-size').selectOption('Small');
 await objPage.locator('#to-payment').click();await objPage.locator('#payment-method').selectOption('online');
 await objPage.locator('#place-order').click();
 assert.match(await objPage.locator('#order-error').textContent(),/require Pay at Pickup/);
 assert.equal(arrOrders.length,3);assert.deepEqual(arrErrors,[]);
});
