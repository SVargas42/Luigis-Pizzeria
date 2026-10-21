import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';

// All submissions use this isolated fixture, including when testing deployed assets.
test('registration alerts handle success, rejections, retry, network failure and safe text',
 {skip:process.env.RUN_BROWSER_TEST!=='1',timeout:90000},async objTest=>{
 const {chromium:objChromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
 const strOrigin=process.env.TEST_ORIGIN;
 const arrAssets=await Promise.all(['account.html','account.js'].map(async strName=>strOrigin
  ? (await fetch(strOrigin+(strName==='account.html'?'/account?mode=register':'/account.js'))).text()
  : readFile(new URL('../public/'+strName,import.meta.url),'utf8')));
 const strCssUrl='https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css';
 const objCssResponse=await fetch(strCssUrl);assert.equal(objCssResponse.ok,true);
 const strCss=await objCssResponse.text(),strHtml=arrAssets[0].replace(strCssUrl,'/bootstrap.css');
 let nStatus=201,objBody={message:'Account created. Verify your email.'};
 const arrRequests=[],arrErrors=[];
 const objServer=createServer(async(objRequest,objResponse)=>{
  const strPath=new URL(objRequest.url,'http://localhost').pathname;
  const send=objData=>{objResponse.setHeader('Content-Type','application/json');objResponse.end(JSON.stringify(objData));};
  if(strPath==='/account'){objResponse.setHeader('Content-Type','text/html');return objResponse.end(strHtml);}
  if(strPath==='/account.js'){objResponse.setHeader('Content-Type','text/javascript');return objResponse.end(arrAssets[1]);}
  if(strPath==='/bootstrap.css'){objResponse.setHeader('Content-Type','text/css');return objResponse.end(strCss);}
  if(strPath==='/api/session')return send({authenticated:false,authReady:true});
  if(strPath==='/api/auth/register'){
   let strBody='';for await(const bufPart of objRequest)strBody+=bufPart;
   arrRequests.push(JSON.parse(strBody));if(nStatus===0)return objRequest.socket.destroy();
   objResponse.statusCode=nStatus;return send(objBody);
  }
  objResponse.statusCode=404;objResponse.end();
 });
 await new Promise(fnResolve=>objServer.listen(0,'127.0.0.1',fnResolve));
 objTest.after(()=>new Promise(fnResolve=>objServer.close(fnResolve)));
 const objBrowser=await objChromium.launch({channel:'chrome',headless:true});objTest.after(()=>objBrowser.close());
 const objPage=await objBrowser.newPage();objPage.on('pageerror',objError=>arrErrors.push(objError.message));
 await objPage.route('**/*',objRoute=>new URL(objRoute.request().url()).hostname==='127.0.0.1'?objRoute.continue():objRoute.abort());
 const fillForm=async()=>{
  await objPage.goto(`http://127.0.0.1:${objServer.address().port}/account?mode=register`);
  assert.equal(await objPage.locator('#register-alert').isVisible(),false);
  for(const [strId,strValue] of [['firstName','Ada'],['lastName','Tester'],['phone','5551234567'],['email','ada@example.com'],['password','a long test passphrase'],['confirmPassword','a long test passphrase']])await objPage.locator('#'+strId).fill(strValue);
 };
 const submit=async()=>{await objPage.locator('#submit').click();await objPage.locator('#register-alert:not(.d-none)').waitFor();};
 await fillForm();
 for(const strConfirmation of ['a long test passphrasE','a long test passphrase ']){
  await objPage.locator('#confirmPassword').fill(strConfirmation);
  await objPage.locator('#confirmPassword').press('Enter');
  await objPage.locator('#register-alert:not(.d-none)').waitFor();
  assert.equal(await objPage.locator('#register-alert').textContent(),'Passwords do not match.');
  assert.match(await objPage.locator('#register-alert').getAttribute('class'),/alert-danger/);
  assert.equal(await objPage.locator('#register-alert').evaluate(objElement=>objElement===document.activeElement),true);
  assert.equal(await objPage.locator('#submit').isEnabled(),true);
  assert.equal(arrRequests.length,0);
 }
 for(const [nResponseStatus,strError] of [[400,'Use a password between 12 and 128 characters.'],[409,'An account with this email already exists.'],[429,'Too many attempts.'],[503,'Account service is temporarily unavailable.']]){
  await fillForm();nStatus=nResponseStatus;objBody={error:strError};await submit();
  assert.equal(await objPage.locator('#register-alert').textContent(),'Error: '+strError);
  assert.match(await objPage.locator('#register-alert').getAttribute('class'),/alert-danger/);
  assert.equal(await objPage.locator('#register-alert').evaluate(objElement=>objElement===document.activeElement),true);
  assert.equal(await objPage.locator('#account-form').isVisible(),true);assert.equal(await objPage.locator('#submit').isEnabled(),true);
 }
 nStatus=201;objBody={message:'Account created. Verify your email.'};await submit();
 assert.equal(await objPage.locator('#register-alert').textContent(),'Success: '+objBody.message);
 assert.match(await objPage.locator('#register-alert').getAttribute('class'),/alert-success/);
 assert.equal(await objPage.locator('#account-form').isVisible(),false);assert.equal(await objPage.locator('#password').inputValue(),'');
 assert.equal(arrRequests.at(-1).email,'ada@example.com');
 assert.equal(await objPage.locator('#confirmPassword').inputValue(),'');
 assert.equal(Object.hasOwn(arrRequests.at(-1),'confirmPassword'),false);
 for(const strMode of ['login','forgot','reset','invite','password']){
  await objPage.goto(`http://127.0.0.1:${objServer.address().port}/account?mode=${strMode}`);
  await objPage.waitForFunction(()=>document.querySelector('#title').textContent!=='Your account'||document.querySelector('#message').textContent!=='');
  assert.equal(await objPage.locator('#confirmPassword').isVisible(),false);
  assert.equal(await objPage.locator('#confirmPassword').evaluate(objElement=>objElement.required),false);
 }
 await fillForm();nStatus=0;await submit();assert.match(await objPage.locator('#register-alert').textContent(),/Error: Unable to complete registration/);
 assert.equal(await objPage.locator('#submit').isEnabled(),true);
 nStatus=400;objBody={error:'<img src=x onerror="window.alert(1)">'};await submit();
 assert.equal(await objPage.locator('#register-alert img').count(),0);assert.equal(await objPage.locator('#register-alert').textContent(),'Error: '+objBody.error);
 assert.deepEqual(arrErrors,[]);
});
