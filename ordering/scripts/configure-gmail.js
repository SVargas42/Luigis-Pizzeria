import {readFileSync,writeFileSync,chmodSync,statSync} from 'node:fs';
import {stdin as objInput,stdout as objOutput} from 'node:process';
import {resolve} from 'node:path';

const strTarget=resolve(process.argv[2]||'.env');
if(!objInput.isTTY)throw Error('Use an interactive SSH terminal; the app password is entered without echo.');
if(process.platform!=='win32'&&statSync(strTarget).uid!==process.getuid())throw Error('Run as the environment file owner (sudo for /etc/luigis.env).');
async function secret(){objOutput.write('Google app password (hidden; do not use your normal Google password): ');objInput.setRawMode(true);objInput.resume();return new Promise((fnResolve,fnReject)=>{let strValue='';function finish(){objInput.off('data',handleData);objInput.setRawMode(false);objInput.pause();objOutput.write('\n');}function handleData(bufData){for(const strChar of bufData.toString('utf8')){if(strChar==='\u0003'){finish();fnReject(Error('Cancelled; settings not changed.'));return;}if(strChar==='\r'||strChar==='\n'){finish();fnResolve(strValue);return;}if(strChar==='\u007f'||strChar==='\b')strValue=strValue.slice(0,-1);else if(strChar>=' ')strValue+=strChar;}}objInput.on('data',handleData);});}
const strPassword=(await secret()).replace(/\s/g,'');
if(!/^[a-zA-Z0-9]{16}$/.test(strPassword))throw Error('Expected a 16-character Google app password; settings not changed.');
let strContents=readFileSync(strTarget,'utf8');
const objValues={MAIL_PROVIDER:'smtp',ACCOUNT_MAIL_FROM:'Luigi Accounts <l7163747@gmail.com>',SMTP_HOST:'smtp.gmail.com',SMTP_PORT:'587',SMTP_FROM:'l7163747@gmail.com',SMTP_USER:'l7163747@gmail.com',SMTP_PASSWORD:strPassword};
for(const [strKey,strValue]of Object.entries(objValues)){const objPattern=new RegExp('^\\s*(?:export\\s+)?'+strKey+'=.*$','gm');const strLine=strKey+'='+JSON.stringify(strValue);strContents=objPattern.test(strContents)?strContents.replace(objPattern,()=>strLine):strContents+'\n'+strLine+'\n';}
writeFileSync(strTarget,strContents);
if(process.platform!=='win32')chmodSync(strTarget,0o640);
console.log('Gmail configuration saved. Database and internal-service credentials were preserved. Restart services and verify delivery.');
