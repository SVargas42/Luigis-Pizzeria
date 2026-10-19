import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {renderNginx} from '../deploy/render-nginx.js';

test('reverse proxy renders a canonical hostname and overwrites client identity headers',()=>{
 const strConfig=renderNginx('Orders.Example.com');
 assert.match(strConfig,/server_name orders\.example\.com;/);
 assert.match(strConfig,/proxy_pass http:\/\/127\.0\.0\.1:3000;/);
 assert.match(strConfig,/proxy_set_header Host \$server_name;/);
 assert.match(strConfig,/proxy_set_header X-Real-IP \$remote_addr;/);
 assert.match(strConfig,/proxy_set_header X-Forwarded-For \$remote_addr;/);
 assert.match(strConfig,/proxy_set_header X-Forwarded-Proto \$scheme;/);
 assert.match(strConfig,/proxy_set_header Forwarded "";/);
 assert.match(strConfig,/client_max_body_size 256k;/);
 assert.match(strConfig,/proxy_cache off;/);
 assert.doesNotMatch(strConfig,/\$http_x_real_ip|\$proxy_add_x_forwarded_for|8000|3306|\broot\s|\balias\s|DOMAIN/);
});
test('invalid proxy domains cannot inject Nginx directives',()=>{
 for(const strDomain of ['',undefined,'https://orders.example.com','orders.example.com:443','orders.example.com/path','example.com; root /tmp;','example.com\nlisten 8000;','*.example.com','-bad.example.com','a..com','a'.repeat(64)+'.com','127.0.0.1'])assert.throws(()=>renderNginx(strDomain));
});
test('proxy CLI fails without writing partial configuration for invalid domains',()=>{
 const objResult=spawnSync(process.execPath,['deploy/render-nginx.js','example.com;'],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
 assert.equal(objResult.status,1);assert.equal(objResult.stdout,'');assert.match(objResult.stderr,/hostname/);
 const objValid=spawnSync(process.execPath,['deploy/render-nginx.js','orders.example.com'],{cwd:new URL('../',import.meta.url),encoding:'utf8'});
 assert.equal(objValid.status,0);assert.equal(objValid.stdout,renderNginx('orders.example.com'));
});
