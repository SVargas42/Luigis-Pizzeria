import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkEnvironment} from '../deploy/check-env.js';
import {mergeEnvironment} from '../deploy/merge-env.js';
import {renderServices} from '../deploy/render-services.js';

function configuration(){return {DB_HOST:'127.0.0.1',DB_PORT:'3306',DB_USER:'luigis_app',DB_NAME:'luigis',DB_PASSWORD:'a'.repeat(64),HOST:'127.0.0.1',PORT:'3000',SITE_URL:'https://luigispizza.duckdns.org',ADMIN_USER:'lifecycle_service',ADMIN_PASSWORD:'b'.repeat(64),LIFECYCLE_URL:'http://127.0.0.1:8000',RESEND_API_KEY:'test-secret-not-real',ACCOUNT_MAIL_FROM:'Luigi <accounts@example.com>',SMTP_HOST:'smtp.example.com',SMTP_PORT:'587',SMTP_FROM:'accounts@example.com',SMTP_USER:'user',SMTP_PASSWORD:'mail-secret-not-real',TRUST_PROXY_LOOPBACK:'1',STRIPE_ENABLED:'0',STRIPE_MODE:'test',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'',TAX_BASIS_POINTS:'0'};}
test('deployment checks distinguish local setup from public email and proxy requirements',()=>{
 const objEnv=configuration();assert.deepEqual(checkEnvironment(objEnv),[]);
 const objLocal={...objEnv,SITE_URL:'http://127.0.0.1:3000',TRUST_PROXY_LOOPBACK:'0',RESEND_API_KEY:'',SMTP_HOST:''};
 assert.deepEqual(checkEnvironment(objLocal,{bLocal:true}),[]);assert.ok(checkEnvironment(objLocal).length>=4);
 for(const objChange of [{SITE_URL:'http://luigispizza.duckdns.org'},{SITE_URL:'https://luigispizza.duckdns.org/path'},{HOST:'0.0.0.0'},{PORT:'abc'},{DB_PASSWORD:'YOUR_DATABASE_PASSWORD'},{ADMIN_PASSWORD:objEnv.DB_PASSWORD},{TAX_BASIS_POINTS:'1.5'},{STRIPE_ENABLED:'1'},{LIFECYCLE_URL:'http://public.example.com'},{SMTP_PORT:'70000'}])assert.ok(checkEnvironment({...objEnv,...objChange}).length,JSON.stringify(Object.keys(objChange)));
 const strSecret='private-value-that-must-not-be-logged';assert.ok(!checkEnvironment({...objEnv,SITE_URL:strSecret}).join('\n').includes(strSecret));
});
test('environment merge preserves existing secrets and appends each missing name only once',()=>{
 const strExisting='# private\r\nDB_PASSWORD="keep-this-value"\r\nexport SITE_URL=https://luigispizza.duckdns.org\r\n';
 const strExample='DB_PASSWORD="YOUR_DATABASE_PASSWORD"\nSITE_URL=http://127.0.0.1:3000\nSTRIPE_ENABLED=0\n';
 const strAppend=mergeEnvironment(strExisting,strExample);assert.match(strAppend,/STRIPE_ENABLED=0/);assert.doesNotMatch(strAppend,/DB_PASSWORD|SITE_URL|keep-this-value/);
 assert.equal(mergeEnvironment(strExisting+strAppend,strExample),'');
});
test('systemd services share the private env and use a non-root account with private Python listener',()=>{
 const objUnits=renderServices('/home/operator/Luigis-Pizzeria','/home/operator/.nvm/versions/node/v24.0.0/bin/node','operator');
 for(const strUnit of Object.values(objUnits)){assert.match(strUnit,/User=operator\n/);assert.match(strUnit,/EnvironmentFile=\/home\/operator\/Luigis-Pizzeria\/ordering\/\.env/);assert.match(strUnit,/Restart=on-failure/);assert.doesNotMatch(strUnit,/DB_PASSWORD|ADMIN_PASSWORD/);}
 assert.match(objUnits['luigis-lifecycle.service'],/--host 127\.0\.0\.1 --port 8000/);assert.match(objUnits['luigis-web.service'],/WorkingDirectory=\/home\/operator\/Luigis-Pizzeria\/ordering/);
 for(const arrArgs of [['/tmp/a\nExecStart=bad','/bin/node','operator'],['/home/a','/bin/node','root'],['/home/../a','/bin/node','operator'],['/home/a','/bin/node','a\nUser=root']])assert.throws(()=>renderServices(...arrArgs));
});
