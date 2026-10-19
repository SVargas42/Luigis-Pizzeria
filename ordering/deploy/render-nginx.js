import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function renderNginx(strDomain){
 if(typeof strDomain!=='string'||strDomain.length>253||!strDomain.includes('.')||!strDomain.split('.').every(strLabel=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(strLabel))||/^\d+(?:\.\d+){3}$/.test(strDomain))throw Error('Provide one DNS hostname, for example orders.yourdomain.com, without a scheme, port or path.');
 const strTemplate=readFileSync(new URL('./nginx.conf',import.meta.url),'utf8');
 return strTemplate.replaceAll('DOMAIN',strDomain.toLowerCase());
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==3)throw Error('Usage: node deploy/render-nginx.js orders.yourdomain.com');process.stdout.write(renderNginx(process.argv[2]));}
 catch(objError){console.error(objError.message);process.exitCode=1;}
}
