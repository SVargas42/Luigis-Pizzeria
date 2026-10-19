import mariadb from 'mariadb';
import Stripe from 'stripe';
import {createPaymentService} from '../payments.js';
if(!['test','live'].includes(process.env.STRIPE_MODE)||!process.env.STRIPE_SECRET_KEY?.startsWith('sk_'+process.env.STRIPE_MODE+'_')||!process.env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'))throw Error('Configure matching Stripe mode, API key and webhook secret before reconciliation.');
const objPool=mariadb.createPool({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME||'luigis',bigIntAsNumber:true,timezone:'Z',initSql:"SET time_zone = '+00:00'",connectionLimit:2});
const objStripe=new Stripe(process.env.STRIPE_SECRET_KEY,{maxNetworkRetries:2,timeout:10000});
const objPayments=createPaymentService(objPool,objStripe,{enabled:true,liveMode:process.env.STRIPE_MODE==='live',siteUrl:process.env.SITE_URL,webhookSecret:process.env.STRIPE_WEBHOOK_SECRET,taxBasisPoints:Number(process.env.TAX_BASIS_POINTS||0)});
const objLock=await objPool.getConnection();
try{const [objAcquired]=await objLock.query("SELECT GET_LOCK('luigi_stripe_reconcile',0) AS acquired");if(Number(objAcquired.acquired)!==1)throw Error('Reconciliation is already running.');const strSession=process.argv[2];if(strSession){if(!/^cs_(test|live)_[A-Za-z0-9]+$/.test(strSession))throw Error('Provide a Stripe Checkout Session ID.');const objReceipt=await objPayments.fulfill(strSession);console.log(objReceipt?`Recovered ${objReceipt.orderNumber}`:'Session belongs to another integration.');}else console.log(await objPayments.reconcile());}finally{await objLock.query("SELECT RELEASE_LOCK('luigi_stripe_reconcile')");objLock.release();await objPool.end();}
