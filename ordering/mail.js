import nodemailer from 'nodemailer';

export function mailConfigFromEnvironment(objEnv){return {mailProvider:objEnv.MAIL_PROVIDER||'resend',mailKey:objEnv.RESEND_API_KEY,mailFrom:objEnv.ACCOUNT_MAIL_FROM,smtp:{host:objEnv.SMTP_HOST,port:Number(objEnv.SMTP_PORT||587),from:objEnv.SMTP_FROM,user:objEnv.SMTP_USER,password:objEnv.SMTP_PASSWORD}};}
export function mailIsConfigured(objConfig){
 if((objConfig.mailProvider||'resend')==='resend')return Boolean(objConfig.mailKey&&objConfig.mailFrom);
 const objSmtp=objConfig.smtp;
 return objConfig.mailProvider==='smtp'&&Boolean(objSmtp?.host&&objSmtp?.from&&objSmtp?.user&&objSmtp?.password&&objConfig.mailFrom)&&objSmtp.port===587;
}
export function smtpOptions(objConfig){
 if(objConfig.mailProvider!=='smtp'||!mailIsConfigured(objConfig))throw Error('SMTP configuration is incomplete; use STARTTLS port 587.');
 return {host:objConfig.smtp.host,port:587,secure:false,requireTLS:true,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},auth:{user:objConfig.smtp.user,pass:objConfig.smtp.password},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true};
}
export async function sendAccountMessage(objConfig,objMail){
 if(!mailIsConfigured(objConfig))throw Error('Email delivery is not configured.');
 if(objConfig.mailProvider==='smtp'){
  const objTransport=nodemailer.createTransport(smtpOptions(objConfig));
  try{
   const strDomain=new URL(objConfig.siteUrl).hostname;
   const objResult=await objTransport.sendMail({from:objConfig.mailFrom,to:objMail.recipient,subject:objMail.subject,text:objMail.message,messageId:`<${objMail.id}@${strDomain}>`,disableFileAccess:true,disableUrlAccess:true});
   if(!Array.isArray(objResult.accepted)||!objResult.accepted.some(strAddress=>String(strAddress).toLowerCase()===objMail.recipient.toLowerCase()))throw Error('SMTP did not accept the recipient.');
  }finally{objTransport.close();}
  return;
 }
 const objResponse=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${objConfig.mailKey}`,'Content-Type':'application/json','Idempotency-Key':objMail.id},body:JSON.stringify({from:objConfig.mailFrom,to:[objMail.recipient],subject:objMail.subject,text:objMail.message}),signal:AbortSignal.timeout(10000)});
 if(!objResponse.ok)throw Error('Email provider failed');
}
