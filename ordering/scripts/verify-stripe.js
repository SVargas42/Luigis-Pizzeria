import Stripe from 'stripe';
if(process.env.STRIPE_MODE!=='test'||!process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_')||!process.env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_'))throw Error('Configure sandbox mode, its secret API key and webhook signing secret first.');
const objStripe=new Stripe(process.env.STRIPE_SECRET_KEY,{timeout:10000,maxNetworkRetries:1});
try{const objBalance=await objStripe.balance.retrieve();if(objBalance.livemode!==false)throw Error();console.log('Stripe sandbox API authentication passed. No charge was created. Webhook delivery and hosted checkout still require sandbox tests.');}
catch{console.error('Stripe sandbox verification failed. Check the account, sandbox key permissions and network. Keys and account data were not printed.');process.exitCode=1;}
