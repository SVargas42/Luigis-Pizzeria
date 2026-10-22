import {pathToFileURL} from 'node:url';

export function checkEnvironment(objEnv,{bLocal=false}={}){
 const arrErrors=[];
 const isValue=strKey=>typeof objEnv[strKey]==='string'&&objEnv[strKey].trim()!==''&&!/YOUR_|REPLACE_|CHOOSE_|your-domain\.example/i.test(objEnv[strKey]);
 for(const strKey of ['DB_HOST','DB_PORT','DB_USER','DB_PASSWORD','DB_NAME','HOST','PORT','SITE_URL','ADMIN_USER','ADMIN_PASSWORD','LIFECYCLE_URL','TAX_BASIS_POINTS'])if(!isValue(strKey))arrErrors.push(`${strKey}: missing or still contains an example value.`);
 for(const strKey of ['DB_PORT','PORT','SMTP_PORT'])if(objEnv[strKey]&&(!/^\d+$/.test(objEnv[strKey])||Number(objEnv[strKey])<1||Number(objEnv[strKey])>65535))arrErrors.push(`${strKey}: use an integer port from 1 to 65535.`);
 for(const strKey of ['DB_HOST','HOST'])if(objEnv[strKey]!=='127.0.0.1')arrErrors.push(`${strKey}: this deployment requires 127.0.0.1.`);
 if(objEnv.LIFECYCLE_URL!=='http://127.0.0.1:8000')arrErrors.push('LIFECYCLE_URL: use http://127.0.0.1:8000 for the private service.');
 try{const objSite=new URL(objEnv.SITE_URL);const bLoopback=['localhost','127.0.0.1','[::1]'].includes(objSite.hostname);if(objSite.pathname!=='/'||objSite.search||objSite.hash||objSite.username||objSite.password||(!bLocal&&bLoopback)||(!bLocal&&objSite.protocol!=='https:')||(bLocal&&objSite.protocol!=='https:'&&!(objSite.protocol==='http:'&&bLoopback)))throw Error();}catch{arrErrors.push('SITE_URL: use your exact HTTPS origin; --local also allows loopback HTTP.');}
 if(!['0','1'].includes(objEnv.TRUST_PROXY_LOOPBACK))arrErrors.push('TRUST_PROXY_LOOPBACK: use 0 or 1.');
 if(!bLocal&&objEnv.TRUST_PROXY_LOOPBACK!=='1')arrErrors.push('TRUST_PROXY_LOOPBACK: use 1 with the supplied same-VM Nginx proxy.');
 if(!/^\d+$/.test(objEnv.TAX_BASIS_POINTS||'')||Number(objEnv.TAX_BASIS_POINTS)>10000)arrErrors.push('TAX_BASIS_POINTS: use an integer from 0 to 10000; confirm the business tax setting.');
 if(!bLocal){
  const strProvider=objEnv.MAIL_PROVIDER||'resend';
  if(!['smtp','resend'].includes(strProvider))arrErrors.push('MAIL_PROVIDER: choose smtp or resend.');
  const arrMailKeys=['ACCOUNT_MAIL_FROM','SMTP_HOST','SMTP_PORT','SMTP_FROM','SMTP_USER','SMTP_PASSWORD',...(strProvider==='resend'?['RESEND_API_KEY']:[])];
  for(const strKey of arrMailKeys)if(!isValue(strKey))arrErrors.push(`${strKey}: configure real email delivery before public release.`);
  if(objEnv.SMTP_PORT!=='587')arrErrors.push('SMTP_PORT: use 587; pickup receipts require STARTTLS.');
  if(strProvider==='smtp'&&objEnv.SMTP_HOST==='smtp.gmail.com')for(const strKey of ['ACCOUNT_MAIL_FROM','SMTP_FROM'])if(!objEnv[strKey]?.toLowerCase().includes(objEnv.SMTP_USER?.toLowerCase()||'\u0000'))arrErrors.push(`${strKey}: Gmail sender must match SMTP_USER.`);
  for(const strKey of ['DB_PASSWORD','ADMIN_PASSWORD'])if(isValue(strKey)&&objEnv[strKey].length<24)arrErrors.push(`${strKey}: use a newly generated secret of at least 24 characters.`);
  if(objEnv.DB_PASSWORD&&objEnv.DB_PASSWORD===objEnv.ADMIN_PASSWORD)arrErrors.push('ADMIN_PASSWORD: use a different secret from DB_PASSWORD.');
 }
 if(!['0','1'].includes(objEnv.STRIPE_ENABLED))arrErrors.push('STRIPE_ENABLED: use 0 or 1.');
 if(!['test','live'].includes(objEnv.STRIPE_MODE))arrErrors.push('STRIPE_MODE: use test or live.');
 if(objEnv.STRIPE_ENABLED==='1'||objEnv.STRIPE_SECRET_KEY||objEnv.STRIPE_WEBHOOK_SECRET){if(!objEnv.STRIPE_SECRET_KEY?.startsWith(`sk_${objEnv.STRIPE_MODE}_`)||!objEnv.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'))arrErrors.push('Stripe: supply a matching mode, secret API key and webhook signing secret.');}
 return arrErrors;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const arrErrors=checkEnvironment(process.env,{bLocal:process.argv.includes('--local')});
 if(arrErrors.length){console.error('Configuration needs attention:\n'+arrErrors.map(strError=>'- '+strError).join('\n'));process.exitCode=1;}
 else console.log('Configuration structure passed. This does not verify credentials, DNS, email delivery, tax policy, or Stripe payments.');
}
