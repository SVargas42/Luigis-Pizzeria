import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const strHome=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
const strServer=readFileSync(new URL('../server.js',import.meta.url),'utf8');
const strAdmin=readFileSync(new URL('../public/admin.html',import.meta.url),'utf8');
const strAccount=readFileSync(new URL('../public/account.html',import.meta.url),'utf8');
const strAccountScript=readFileSync(new URL('../public/account.js',import.meta.url),'utf8');
const strManagement=readFileSync(new URL('../public/management.html',import.meta.url),'utf8');

test('admin homepage link opens Management Settings and every workspace has a server route',()=>{
 assert.match(strHome,/id="admin-analytics-link" href="\/admin\/management">Management Settings<\/a>/);
 for(const [strPath,strPage] of [['/admin/management','management.html'],['/admin/analytics','admin.html'],['/admin','admin.html'],['/admin/accounts','account.html'],['/admin/menu','admin.html']]){
  assert.ok(strServer.includes(`'${strPath}':'${strPage}'`),`${strPath} should resolve to ${strPage}`);
 }
 for(const strHref of ['/admin/analytics','/admin','/admin/accounts','/admin/menu'])assert.ok(strManagement.includes(`href="${strHref}"`));
});

test('menu editor is only reachable from its own page and Orders keeps its own tabs',()=>{
 assert.ok(strAdmin.includes("const bMenuPage=location.pathname==='/admin/menu'"));
 assert.ok(strAdmin.includes("if(bMenuPage)loadMenu();else setTab(objInitialTab)"));
 assert.ok(!strAdmin.includes('id="tab-menu"'));
 assert.ok(strAdmin.includes('id="panel-menu"'));
 assert.ok(strAdmin.includes('id="tab-current"')&&strAdmin.includes('id="tab-past"'));
});

test('admin workspace pages use the analytics-style banner and only back and home navigation',()=>{
 assert.ok(strAdmin.includes('grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)'));
 assert.ok(strAdmin.includes('aria-label="Page navigation"><a id="go-back"'));
 assert.ok(strAdmin.includes('>Go back</a><a href="/">Return to Home</a>'));
 assert.ok(!strAccount.includes('site-hero'));
 assert.ok(strAccount.includes('id="management-header" class="admin-page-header"'));
 assert.ok(strAccount.includes('href="/admin/management">Go back</a><a href="/">Return to Home</a>'));
 assert.ok(strManagement.includes('>Go back</a><a href="/">Return to Home</a>'));
 assert.ok(strAccountScript.includes("$('management-header').hidden=false"));
});

test('account management route reveals the standard header for an administrator',async()=>{
 const mapElements=new Map();
 function createElement(){return {hidden:false,value:'',textContent:'',href:'',children:[],className:'',classList:{toggle(){},add(){}},handlers:{},append(...arrChildren){this.children.push(...arrChildren);},replaceChildren(){this.children=[];},focus(){this.focused=true;},addEventListener(strName,fnHandler){this.handlers[strName]=fnHandler;},setAttribute(){},removeAttribute(){},querySelector(){return {disabled:false};}};}
 const getElement=strId=>{if(!mapElements.has(strId)){const objElement=createElement();if(strId==='management-back')objElement.href='https://luigispizza.example/admin/management';mapElements.set(strId,objElement);}return mapElements.get(strId);};
 const objContext={document:{getElementById:getElement,createElement,referrer:'https://luigispizza.example/admin/management'},location:{pathname:'/admin/accounts',search:'',hash:''},history:{length:2},URLSearchParams,URL,fetch:async strPath=>({ok:true,json:async()=>strPath==='/api/session'?{authenticated:true,user:{role:'admin'}}:[]})};
 vm.createContext(objContext);vm.runInContext(strAccountScript,objContext);
 await new Promise(fnResolve=>setImmediate(fnResolve));
 assert.equal(getElement('management').hidden,false);
 assert.equal(getElement('management-header').hidden,false);
 assert.equal(getElement('management-back').href,'https://luigispizza.example/admin/management');
 assert.equal(getElement('management-title').focused,true);
});
