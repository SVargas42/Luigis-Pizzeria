import nodemailer from 'nodemailer';
import {mailConfigFromEnvironment,smtpOptions} from '../mail.js';
const objConfig={siteUrl:process.env.SITE_URL,...mailConfigFromEnvironment(process.env)};
const objTransport=nodemailer.createTransport(smtpOptions(objConfig));
try{await objTransport.verify();console.log('SMTP connection, TLS and authentication passed. No email was sent. Actual delivery still needs a recipient test.');}
catch{console.error('SMTP verification failed. Check the Google app password, 2-Step Verification, Gmail security notifications, and outbound port 587. No credentials were printed.');process.exitCode=1;}
finally{objTransport.close();}
