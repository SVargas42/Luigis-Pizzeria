import readline from 'node:readline/promises';
import {stdin as objInput,stdout as objOutput} from 'node:process';
import mariadb from 'mariadb';
import {hashPassword,validateProfile} from '../accounts.js';
const objQuestions=readline.createInterface({input:objInput,output:objOutput});
const objProfile=validateProfile({firstName:await objQuestions.question('First name: '),lastName:await objQuestions.question('Last name: '),email:await objQuestions.question('Email: '),phone:await objQuestions.question('Phone: ')});
objQuestions.close();
if(!objInput.isTTY)throw Error('Run in an interactive terminal; the password is read without echo.');
async function secret(strPrompt){objOutput.write(strPrompt);objInput.setRawMode(true);objInput.resume();return new Promise((fnResolve,fnReject)=>{let strValue='';function handleData(bufData){for(const strChar of bufData.toString('utf8')){if(strChar==='\u0003'){finish();fnReject(Error('Cancelled'));return;}if(strChar==='\r'||strChar==='\n'){finish();fnResolve(strValue);return;}if(strChar==='\u007f'||strChar==='\b')strValue=strValue.slice(0,-1);else if(strChar>=' ')strValue+=strChar;}}function finish(){objInput.off('data',handleData);objInput.setRawMode(false);objInput.pause();objOutput.write('\n');}objInput.on('data',handleData);});}
const strPassword=await secret('Admin password (12–128 characters, hidden): ');if(strPassword!==await secret('Confirm password: '))throw Error('Passwords do not match.');
const strHash=await hashPassword(strPassword);
const objConnection=await mariadb.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'luigis',bigIntAsNumber:true});
try{await objConnection.beginTransaction();const [objLock]=await objConnection.query("SELECT GET_LOCK('luigi_bootstrap_admin',10) AS acquired");if(Number(objLock.acquired)!==1)throw Error('Another bootstrap is running.');
 const arrExisting=await objConnection.query("SELECT id FROM accounts WHERE role='admin' AND disabled_at IS NULL LIMIT 1");if(arrExisting.length)throw Error('An administrator already exists. Use the authenticated staff invitation screen.');
 const objResult=await objConnection.query("INSERT INTO accounts(email,first_name,last_name,phone,password_hash,role,email_verified_at) VALUES(?,?,?,?,?,'admin',UTC_TIMESTAMP())",[objProfile.email,objProfile.firstName,objProfile.lastName,objProfile.phone,strHash]);await objConnection.query("INSERT INTO account_audit(actor_id,target_id,action) VALUES(?,?,'bootstrap_admin')",[objResult.insertId,objResult.insertId]);await objConnection.commit();console.log('Administrator created. Sign in at /account.');
}catch(objError){await objConnection.rollback();throw objError;}finally{await objConnection.query("SELECT RELEASE_LOCK('luigi_bootstrap_admin')");await objConnection.end();}
