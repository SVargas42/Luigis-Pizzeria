import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';

test('pizza quantities update totals, preserve keyboard input and reach checkout',
 {skip:process.env.RUN_BROWSER_TEST!=='1',timeout:90000},async objTest=>{
 const {chromium:objChromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
 const strHtml=await readFile(new URL('../../index.html',import.meta.url),'utf8'),arrErrors=[];
 const objServer=createServer((objRequest,objResponse)=>{
  const strPath=new URL(objRequest.url,'http://localhost').pathname;
  const send=objValue=>{objResponse.setHeader('Content-Type','application/json');objResponse.end(JSON.stringify(objValue));};
  if(strPath==='/'){objResponse.setHeader('Content-Type','text/html');return objResponse.end(strHtml);}
  if(strPath==='/stripe-checkout.js'){objResponse.setHeader('Content-Type','text/javascript');return objResponse.end('async function beginStripeCheckout(objPayload){window.objCapturedCheckout=objPayload;}');}
  if(strPath==='/api/session')return send({authenticated:true,authReady:true,user:{id:'1',role:'customer',firstName:'UI',lastName:'Tester',email:'ui@example.invalid',phone:'(555) 123-4567'}});
  if(strPath==='/api/menu')return send([{category:'pizza',name:'Small',price_cents:1000},{category:'pizza',name:'Large',price_cents:1500},{category:'topping',name:'Pepperoni',price_cents:200}]);
  objResponse.statusCode=404;objResponse.end();
 });
 await new Promise(fnResolve=>objServer.listen(0,'127.0.0.1',fnResolve));objTest.after(()=>new Promise(fnResolve=>objServer.close(fnResolve)));
 const objBrowser=await objChromium.launch({headless:true,channel:'chrome'});objTest.after(()=>objBrowser.close());
 const objPage=await objBrowser.newPage();objPage.on('pageerror',objError=>arrErrors.push(objError.message));
 await objPage.route('**/*',objRoute=>new URL(objRoute.request().url()).hostname==='127.0.0.1'?objRoute.continue():objRoute.abort());
 await objPage.goto(`http://127.0.0.1:${objServer.address().port}/`);
 await objPage.locator('#start-order:not([disabled])').waitFor();
 assert.match(await objPage.locator('#start-order').textContent(),/Start your Order/);
 await objPage.locator('#start-order').click();
 await objPage.getByRole('radio',{name:'Small',exact:true}).check();
 await objPage.locator('#pizzas-container input[type=checkbox][value=Pepperoni]').check();
 let objQuantity=objPage.getByRole('spinbutton',{name:'Quantity of pizza 1',exact:true});
 await objQuantity.fill('30');await objQuantity.press('Tab');
 assert.equal(await objPage.locator('#menu-total').textContent(),'$360.00');
 assert.equal(await objPage.locator('#pizzas-container .pizza-builder').count(),1);
 assert.equal(await objPage.locator('#add-pizza').isDisabled(),true);
 await objQuantity.fill('29');assert.equal(await objPage.locator('#add-pizza').isEnabled(),true);
 await objPage.getByRole('button',{name:'＋ Add another pizza',exact:true}).click();
 await objPage.locator('.pizza-builder').nth(1).getByRole('radio',{name:'Large',exact:true}).check();
 await objPage.locator('.pizza-builder').nth(0).getByRole('button',{name:/Pizza 1/}).click();
 objQuantity=objPage.getByRole('spinbutton',{name:'Quantity of pizza 1',exact:true});
 await objQuantity.fill('30');await objPage.locator('#to-payment').click();
 assert.match(await objPage.locator('#menu-error').textContent(),/no more than 30/);
 assert.equal(await objPage.locator('#step-3').isVisible(),false);
 await objQuantity.fill('29');await objPage.locator('#to-payment').click();
 assert.equal(await objPage.locator('#payment-total').textContent(),'$363.00');
 await objPage.locator('#place-order').click();await objPage.waitForFunction(()=>Boolean(window.objCapturedCheckout));
 const objPayload=await objPage.evaluate(()=>window.objCapturedCheckout);
 assert.equal(objPayload.pizzas.length,30);assert.equal(objPayload.pizzas.filter(objPizza=>objPizza.size==='Small').length,29);
 assert.deepEqual(arrErrors,[]);
 await objPage.setViewportSize({width:390,height:844});await objPage.locator('[data-go="2"]').click();
 assert.equal(await objPage.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 });
