import {randomBytes,randomUUID,createHash,scrypt as deriveKey,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {isIP} from 'node:net';
const derivePassword=promisify(deriveKey);
export function digestToken(strToken){return createHash('sha256').update(strToken).digest('hex');}
function error(nStatus,strMessage){return Object.assign(new Error(strMessage),{status:nStatus});}
export function validateProfile(objInput){
 const objResult={};
 for(const strKey of ['firstName','lastName']){const strValue=objInput?.[strKey];if(typeof strValue!=='string'||!strValue.trim()||strValue.trim().length>80||/[\x00-\x1f]/.test(strValue))throw error(400,'First and last name are required (maximum 80 characters each).');objResult[strKey]=strValue.trim();}
 if(typeof objInput?.email!=='string'||objInput.email.trim().length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(objInput.email.trim()))throw error(400,'Enter a valid email address.');
 objResult.email=objInput.email.trim().toLowerCase();
 if(typeof objInput.phone!=='string'||!/^[+0-9() .-]{7,30}$/.test(objInput.phone)||!/^\d{7,15}$/.test(objInput.phone.replace(/\D/g,'')))throw error(400,'A phone number with 7 to 15 digits is required.');
 objResult.phone=objInput.phone.trim();return objResult;
}
export function validatePassword(strPassword){if(typeof strPassword!=='string'||strPassword.length<12||strPassword.length>128)throw error(400,'Use a password between 12 and 128 characters.');return strPassword;}
export async function hashPassword(strPassword){validatePassword(strPassword);const strSalt=randomBytes(16).toString('hex');const bufKey=await derivePassword(strPassword,strSalt,64,{N:32768,r:8,p:1,maxmem:67108864});return `scrypt$${strSalt}$${bufKey.toString('hex')}`;}
export async function verifyPassword(strPassword,strHash){
 if(typeof strPassword!=='string'||strPassword.length>128)return false;
 const arrParts=String(strHash||'').split('$');const bValid=arrParts[0]==='scrypt'&&/^[a-f0-9]{32}$/.test(arrParts[1]||'')&&/^[a-f0-9]{128}$/.test(arrParts[2]||'');
 // Unknown accounts still perform the expensive derivation to reduce timing disclosure.
 const bufKey=await derivePassword(strPassword,bValid?arrParts[1]:'00000000000000000000000000000000',64,{N:32768,r:8,p:1,maxmem:67108864});
 return bValid&&timingSafeEqual(bufKey,Buffer.from(arrParts[2],'hex'));
}
export function readSessionToken(objRequest){const strCookie=String(objRequest.headers.cookie||'');const strToken=strCookie.split(';').map(strPart=>strPart.trim()).find(strPart=>strPart.startsWith('luigi_session='))?.slice(14);return /^[a-f0-9]{64}$/.test(strToken||'')?strToken:null;}
function publicProfile(objRow){return {id:String(objRow.id),email:objRow.email,firstName:objRow.first_name,lastName:objRow.last_name,phone:objRow.phone,role:objRow.role};}
export function createAccountService(objPool,objConfig){
 const objSite=new URL(objConfig.siteUrl);
 if(objSite.pathname!=='/'||objSite.search||objSite.hash||objSite.username||objSite.password)throw Error('SITE_URL must be an origin, without a path or credentials.');
 const bLocal=['localhost','127.0.0.1','[::1]'].includes(objSite.hostname);
 if(objSite.protocol!=='https:'&&!(objSite.protocol==='http:'&&bLocal))throw Error('SITE_URL must use HTTPS outside localhost.');
 const strCookieFlags=`; Path=/; HttpOnly; SameSite=Lax${objSite.protocol==='https:'?'; Secure':''}`;
 async function identity(objRequest){
  const strToken=readSessionToken(objRequest);if(!strToken)return null;
  const [objRow]=await objPool.query('SELECT a.* FROM account_sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP() AND a.disabled_at IS NULL AND a.email_verified_at IS NOT NULL',[digestToken(strToken)]);
  return objRow?publicProfile(objRow):null;
 }
 async function audit(objConnection,nActor,nTarget,strAction){await objConnection.query('INSERT INTO account_audit(actor_id,target_id,action) VALUES(?,?,?)',[nActor,nTarget,strAction]);}
 async function throttle(objRequest,strEmail){
  const strPeer=objRequest.socket.remoteAddress;
  const strProxyAddress=objRequest.headers['x-real-ip'];
  const bTrustedProxy=objConfig.trustLoopbackProxy&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(strPeer)&&typeof strProxyAddress==='string'&&isIP(strProxyAddress);
  const strAddress=bTrustedProxy?strProxyAddress:strPeer;
  for(const [strKey,nLimit] of [[`ip:${strAddress}`,80],[`email:${strEmail}`,10]]){
   const strBucket=digestToken(strKey);
   await objPool.query('INSERT INTO account_throttles(bucket,attempts,expires_at) VALUES(?,1,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE)) ON DUPLICATE KEY UPDATE attempts=IF(expires_at<UTC_TIMESTAMP(),1,attempts+1),expires_at=IF(expires_at<UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 15 MINUTE),expires_at)',[strBucket]);
   const [objBucket]=await objPool.query('SELECT attempts FROM account_throttles WHERE bucket=?',[strBucket]);if(Number(objBucket.attempts)>nLimit)throw error(429,'Too many attempts. Please try again in 15 minutes.');
  }
 }
 function requireMail(){if(!objConfig.mailKey||!objConfig.mailFrom)throw error(503,'Account email delivery is not configured. Please contact the restaurant.');}
 async function enqueueAction(objConnection,objAccount,strPurpose){
  const strToken=randomBytes(32).toString('hex');
  await objConnection.query('DELETE FROM account_actions WHERE account_id=? AND purpose=?',[objAccount.id,strPurpose]);
  await objConnection.query('INSERT INTO account_actions(token_hash,account_id,purpose,expires_at) VALUES(?,?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 60 MINUTE))',[digestToken(strToken),objAccount.id,strPurpose]);
  const strLink=`${objSite.origin}/account#action=${strPurpose}&token=${strToken}`;
  const strSubject={verify:'Verify your Luigi account',reset:'Reset your Luigi password',invite:'Accept your Luigi staff invitation'}[strPurpose];
  await objConnection.query('INSERT INTO account_mail(id,recipient,subject,message) VALUES(?,?,?,?)',[randomUUID(),objAccount.email,strSubject,`${strSubject}:\n${strLink}\n\nThis link expires in 60 minutes. If you did not request it, ignore this email.`]);
 }
 async function transaction(fnWork){const objConnection=await objPool.getConnection();try{await objConnection.beginTransaction();const objResult=await fnWork(objConnection);await objConnection.commit();return objResult;}catch(objError){await objConnection.rollback();throw objError;}finally{objConnection.release();}}
 async function login(objRequest,objInput){
  const strEmail=typeof objInput.email==='string'?objInput.email.trim().toLowerCase():'';await throttle(objRequest,strEmail);
  const [objAccount]=await objPool.query('SELECT * FROM accounts WHERE email=?',[strEmail]);
  if(!await verifyPassword(objInput.password,objAccount?.password_hash)||!objAccount||objAccount.disabled_at)throw error(401,'Invalid email or password.');
  if(!objAccount.email_verified_at)throw error(403,'Verify your email before signing in. Use Resend verification if the link has expired.');
  const strToken=randomBytes(32).toString('hex');
  await transaction(async objConnection=>{
   const [objCurrent]=await objConnection.query('SELECT password_hash,disabled_at FROM accounts WHERE id=? FOR UPDATE',[objAccount.id]);
   if(objCurrent.disabled_at||objCurrent.password_hash!==objAccount.password_hash)throw error(401,'Please sign in again.');
   const strOld=readSessionToken(objRequest);if(strOld)await objConnection.query('DELETE FROM account_sessions WHERE token_hash=?',[digestToken(strOld)]);
   await objConnection.query('INSERT INTO account_sessions(token_hash,account_id,expires_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 8 HOUR))',[digestToken(strToken),objAccount.id]);
   await audit(objConnection,objAccount.id,objAccount.id,'login');
  });
  return {status:200,data:{authenticated:true,authReady:true,user:publicProfile(objAccount)},cookie:`luigi_session=${strToken}; Max-Age=28800${strCookieFlags}`};
 }
 async function handle(objRequest,strPath,objInput={}){
  if(strPath==='/api/auth/login')return login(objRequest,objInput);
  if(strPath==='/api/auth/register'){
   requireMail();const objProfile=validateProfile(objInput);validatePassword(objInput.password);
   if(objInput.role&&objInput.role!=='customer')throw error(400,'Staff accounts are invitation-only.');
   await throttle(objRequest,objProfile.email);const strHash=await hashPassword(objInput.password);
   try{await transaction(async objConnection=>{const objResult=await objConnection.query("INSERT INTO accounts(email,first_name,last_name,phone,password_hash,role) VALUES(?,?,?,?,?,'customer')",[objProfile.email,objProfile.firstName,objProfile.lastName,objProfile.phone,strHash]);await enqueueAction(objConnection,{id:objResult.insertId,email:objProfile.email},'verify');await audit(objConnection,null,objResult.insertId,'registered');});}catch(objError){if(objError.code!=='ER_DUP_ENTRY')throw objError;}
   return {status:202,data:{message:'If registration is available for this email, a verification link will arrive shortly. Existing users can sign in or reset their password.'}};
  }
  if(['/api/auth/forgot','/api/auth/resend'].includes(strPath)){
   requireMail();const strEmail=typeof objInput.email==='string'?objInput.email.trim().toLowerCase():'';await throttle(objRequest,strEmail);
   await transaction(async objConnection=>{const [objAccount]=await objConnection.query('SELECT * FROM accounts WHERE email=? AND disabled_at IS NULL FOR UPDATE',[strEmail]);if(objAccount&&(strPath.endsWith('forgot')||!objAccount.email_verified_at))await enqueueAction(objConnection,objAccount,strPath.endsWith('forgot')?'reset':objAccount.password_hash?'verify':'invite');});
   return {status:202,data:{message:'If an eligible account exists, an email will arrive shortly.'}};
  }
  if(['/api/auth/verify','/api/auth/reset','/api/auth/accept-invite'].includes(strPath)){
   await throttle(objRequest,digestToken(String(objInput.token||'')));
   if(!/^[a-f0-9]{64}$/.test(objInput.token||''))throw error(400,'Invalid or expired link.');
   const strPurpose=strPath.endsWith('verify')?'verify':strPath.endsWith('reset')?'reset':'invite';
   const strHash=strPurpose==='verify'?null:await hashPassword(objInput.password);
   await transaction(async objConnection=>{
    const [objAction]=await objConnection.query('SELECT * FROM account_actions WHERE token_hash=? AND purpose=? AND expires_at>UTC_TIMESTAMP() FOR UPDATE',[digestToken(objInput.token),strPurpose]);
    if(!objAction)throw error(400,'Invalid or expired link.');
    const [objAccount]=await objConnection.query('SELECT disabled_at FROM accounts WHERE id=? FOR UPDATE',[objAction.account_id]);if(objAccount.disabled_at)throw error(400,'Invalid or expired link.');
    if(strHash){await objConnection.query('UPDATE accounts SET password_hash=?,email_verified_at=COALESCE(email_verified_at,UTC_TIMESTAMP()) WHERE id=?',[strHash,objAction.account_id]);await objConnection.query('DELETE FROM account_sessions WHERE account_id=?',[objAction.account_id]);}
    else await objConnection.query('UPDATE accounts SET email_verified_at=UTC_TIMESTAMP() WHERE id=?',[objAction.account_id]);
    await objConnection.query('DELETE FROM account_actions WHERE account_id=?',[objAction.account_id]);await audit(objConnection,objAction.account_id,objAction.account_id,strPurpose);
   });
   return {status:200,data:{message:'Account updated. You can sign in now.'}};
  }
  if(strPath==='/api/auth/logout'){const strToken=readSessionToken(objRequest);if(strToken)await objPool.query('DELETE FROM account_sessions WHERE token_hash=?',[digestToken(strToken)]);return {status:200,data:{message:'Signed out.'},cookie:`luigi_session=; Max-Age=0${strCookieFlags}`};}
  const objIdentity=await identity(objRequest);if(!objIdentity)throw error(401,'Sign in to continue.');
  if(strPath==='/api/auth/profile'){
   const objProfile=validateProfile({...objInput,email:objIdentity.email});await objPool.query('UPDATE accounts SET first_name=?,last_name=?,phone=? WHERE id=?',[objProfile.firstName,objProfile.lastName,objProfile.phone,objIdentity.id]);
   return {status:200,data:{message:'Profile saved.',user:{...objIdentity,...objProfile}}};
  }
  if(strPath==='/api/auth/password'){
   const [objAccount]=await objPool.query('SELECT password_hash FROM accounts WHERE id=?',[objIdentity.id]);await throttle(objRequest,objIdentity.email);
   if(!await verifyPassword(objInput.currentPassword,objAccount.password_hash))throw error(401,'Current password is incorrect.');
   const strHash=await hashPassword(objInput.password);
   await transaction(async objConnection=>{await objConnection.query('UPDATE accounts SET password_hash=? WHERE id=?',[strHash,objIdentity.id]);await objConnection.query('DELETE FROM account_sessions WHERE account_id=?',[objIdentity.id]);await audit(objConnection,objIdentity.id,objIdentity.id,'password_changed');});
   return {status:200,data:{message:'Password changed. Sign in again.'},cookie:`luigi_session=; Max-Age=0${strCookieFlags}`};
  }
  if(objIdentity.role!=='admin')throw error(403,'Administrator access required.');
  if(strPath==='/api/admin/accounts/invite'){
   requireMail();const objProfile=validateProfile(objInput);if(!['customer','admin'].includes(objInput.role))throw error(400,'Choose a supported role.');
   const [objActor]=await objPool.query('SELECT password_hash FROM accounts WHERE id=?',[objIdentity.id]);await throttle(objRequest,objIdentity.email);if(!await verifyPassword(objInput.currentPassword,objActor.password_hash))throw error(401,'Confirm your current password.');
   await transaction(async objConnection=>{const objResult=await objConnection.query('INSERT INTO accounts(email,first_name,last_name,phone,role) VALUES(?,?,?,?,?)',[objProfile.email,objProfile.firstName,objProfile.lastName,objProfile.phone,objInput.role]);await enqueueAction(objConnection,{id:objResult.insertId,email:objProfile.email},'invite');await audit(objConnection,objIdentity.id,objResult.insertId,'invited');});
   return {status:201,data:{message:'Invitation queued. It expires in 60 minutes.'}};
  }
  if(strPath==='/api/admin/accounts/update'){
   const [objActor]=await objPool.query('SELECT password_hash FROM accounts WHERE id=?',[objIdentity.id]);await throttle(objRequest,objIdentity.email);if(!await verifyPassword(objInput.currentPassword,objActor.password_hash))throw error(401,'Confirm your current password.');
   if(!/^\d+$/.test(String(objInput.id))||!['customer','admin'].includes(objInput.role)||typeof objInput.disabled!=='boolean')throw error(400,'Choose an account, role, and enabled status.');
   await transaction(async objConnection=>{
    // Lock the active admin set in a stable order so two admins cannot remove each other simultaneously.
    const arrAdmins=await objConnection.query("SELECT id FROM accounts WHERE role='admin' AND disabled_at IS NULL ORDER BY id FOR UPDATE");
    const [objTarget]=await objConnection.query('SELECT role,disabled_at FROM accounts WHERE id=? FOR UPDATE',[objInput.id]);if(!objTarget)throw error(404,'Account not found.');
    if(String(objInput.id)===objIdentity.id)throw error(409,'An administrator must not disable or change their own role.');
    if(objTarget.role==='admin'&&!objTarget.disabled_at&&(objInput.disabled||objInput.role!=='admin')&&arrAdmins.length<=1)throw error(409,'At least one administrator must remain.');
    await objConnection.query('UPDATE accounts SET role=?,disabled_at=IF(?,UTC_TIMESTAMP(),NULL) WHERE id=?',[objInput.role,objInput.disabled,objInput.id]);await objConnection.query('DELETE FROM account_sessions WHERE account_id=?',[objInput.id]);await audit(objConnection,objIdentity.id,objInput.id,objInput.disabled?'disabled':'role_updated');
   });return {status:200,data:{message:'Account updated. Existing sessions revoked.'}};
  }
  throw error(404,'Account endpoint not found.');
 }
 async function claimOrder(strRequestKey,objIdentity){
  // A separate ownership record keeps pre-account/guest orders from being exposed by email matching.
  if(!/^[0-9a-f-]{36}$/i.test(strRequestKey||''))throw error(400,'Invalid order key.');
  return transaction(async objConnection=>{
   const [objExisting]=await objConnection.query('SELECT a.account_id FROM orders o LEFT JOIN account_order_claims a ON a.request_key=o.request_key WHERE o.request_key=?',[strRequestKey]);
   if(objExisting&&String(objExisting.account_id??null)!==String(objIdentity?.id??null))throw error(409,'Start a new order. This retry key belongs to an earlier checkout.');
   if(!objIdentity){const [objClaim]=await objConnection.query('SELECT account_id FROM account_order_claims WHERE request_key=?',[strRequestKey]);if(objClaim)throw error(401,'Sign in to resume this checkout.');return;}
   await objConnection.query('INSERT INTO account_order_claims(request_key,account_id) VALUES(?,?) ON DUPLICATE KEY UPDATE request_key=request_key',[strRequestKey,objIdentity.id]);
   const [objClaim]=await objConnection.query('SELECT account_id FROM account_order_claims WHERE request_key=?',[strRequestKey]);if(String(objClaim.account_id)!==String(objIdentity.id))throw error(403,'This checkout belongs to another account.');
  });
 }
 return {identity,handle,claimOrder,limitCheckout:(objRequest,strEmail)=>throttle(objRequest,'checkout:'+String(strEmail)),async listAccounts(){return objPool.query('SELECT id,email,first_name,last_name,phone,role,email_verified_at,disabled_at,created_at FROM accounts ORDER BY id DESC LIMIT 200');}};
}
export async function deliverAccountMail(objPool,objConfig){
 if(!objConfig.mailKey||!objConfig.mailFrom)return;
 const objConnection=await objPool.getConnection();
 try{await objConnection.beginTransaction();const [objMail]=await objConnection.query("SELECT * FROM account_mail WHERE sent_at IS NULL AND (purpose='receipt' OR created_at>DATE_SUB(UTC_TIMESTAMP(),INTERVAL 60 MINUTE)) AND next_attempt_at<=UTC_TIMESTAMP() AND attempts<10 ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED");if(!objMail){await objConnection.commit();return;}
  try{const objResponse=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${objConfig.mailKey}`,'Content-Type':'application/json','Idempotency-Key':objMail.id},body:JSON.stringify({from:objConfig.mailFrom,to:[objMail.recipient],subject:objMail.subject,text:objMail.message}),signal:AbortSignal.timeout(10000)});if(!objResponse.ok)throw Error('Email provider failed');await objConnection.query("UPDATE account_mail SET sent_at=UTC_TIMESTAMP(),message='',attempts=attempts+1 WHERE id=?",[objMail.id]);}
  catch{await objConnection.query('UPDATE account_mail SET attempts=attempts+1,next_attempt_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 5 MINUTE) WHERE id=?',[objMail.id]);}
  await objConnection.commit();
 }catch(objError){await objConnection.rollback();throw objError;}finally{objConnection.release();}
}
