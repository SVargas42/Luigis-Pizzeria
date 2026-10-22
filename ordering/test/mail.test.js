import {test} from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import {mailConfigFromEnvironment,mailIsConfigured,smtpOptions,sendAccountMessage} from '../mail.js';

function configuration(){return {siteUrl:'https://luigispizza.duckdns.org',...mailConfigFromEnvironment({MAIL_PROVIDER:'smtp',ACCOUNT_MAIL_FROM:'Luigi Accounts <sender@example.com>',SMTP_HOST:'smtp.gmail.com',SMTP_PORT:'587',SMTP_FROM:'sender@example.com',SMTP_USER:'sender@example.com',SMTP_PASSWORD:'test-secret-not-a-credential'})};}
const objMail={id:'a3abc28a-c16f-43a0-b190-8e300755dcff',recipient:'recipient@example.com',subject:'Verify your account',message:'One-time verification link'};
test('SMTP readiness requires complete credentials and STARTTLS port 587 without a Resend key',()=>{
 const objConfig=configuration();assert.equal(mailIsConfigured(objConfig),true);assert.equal(mailIsConfigured({...objConfig,smtp:{...objConfig.smtp,password:''}}),false);assert.equal(mailIsConfigured({...objConfig,smtp:{...objConfig.smtp,port:465}}),false);assert.equal(mailIsConfigured({...objConfig,mailProvider:'unknown'}),false);
 const objOptions=smtpOptions(objConfig);assert.equal(objOptions.secure,false);assert.equal(objOptions.requireTLS,true);assert.equal(objOptions.tls.rejectUnauthorized,true);assert.equal(objOptions.debug,false);assert.equal(objOptions.disableFileAccess,true);assert.equal(objOptions.disableUrlAccess,true);assert.equal(objOptions.auth.pass,objConfig.smtp.password);
 assert.equal(mailIsConfigured({mailKey:'legacy-key',mailFrom:'sender@example.com'}),true);
});
test('SMTP uses the approved sender and stable message ID without invoking the Resend API',async objTest=>{
 const arrMessages=[];let nClosed=0;
 objTest.mock.method(nodemailer,'createTransport',objOptions=>{assert.equal(objOptions.requireTLS,true);return {async sendMail(objMessage){arrMessages.push(objMessage);return {accepted:[objMail.recipient]};},close(){nClosed++;}};});
 const objFetch=objTest.mock.method(globalThis,'fetch',()=>{throw Error('SMTP must not invoke Resend');});
 await sendAccountMessage(configuration(),objMail);await sendAccountMessage(configuration(),objMail);
 assert.equal(arrMessages[0].from,'Luigi Accounts <sender@example.com>');assert.equal(arrMessages[0].messageId,arrMessages[1].messageId);assert.equal(arrMessages[0].text,objMail.message);assert.equal(nClosed,2);assert.equal(objFetch.mock.callCount(),0);
});
test('SMTP rejects an unaccepted recipient and closes the transport after failure',async objTest=>{
 let nClosed=0;
 objTest.mock.method(nodemailer,'createTransport',()=>({async sendMail(){return {accepted:[]};},close(){nClosed++;}}));
 await assert.rejects(sendAccountMessage(configuration(),objMail),/did not accept/);assert.equal(nClosed,1);
});
