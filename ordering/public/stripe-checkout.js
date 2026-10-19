let bStripeAvailable=false;
const objPaymentSelect=document.getElementById('payment-method');
const objPaymentMessage=document.createElement('p');objPaymentMessage.id='stripe-status';objPaymentMessage.setAttribute('role','status');objPaymentMessage.setAttribute('aria-live','polite');objPaymentSelect.after(objPaymentMessage);
const objRetry=document.createElement('button');objRetry.type='button';objRetry.textContent='Check payment status';objRetry.className='btn btn-outline-secondary';objRetry.hidden=true;objPaymentMessage.after(objRetry);
const objResume=document.createElement('a');objResume.textContent='Resume Stripe checkout';objResume.className='btn btn-outline-secondary';objResume.hidden=true;objRetry.after(objResume);
const strStorageKey='luigiStripeCheckout';
function readCheckout(){try{const objStored=JSON.parse(sessionStorage.getItem(strStorageKey)||'null');return objStored&&/^[a-f0-9]{64}$/.test(objStored.checkoutToken||'')?objStored:null;}catch{return null;}}
async function paymentApi(strPath,objInput){const objResponse=await fetch(strPath,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(objInput)});const objResult=await objResponse.json();if(!objResponse.ok)throw Error(objResult.error||'Payment is not confirmed. Please check again before paying again.');return objResult;}
function showVerifiedReceipt(objResult){const objReceipt=objResult.receipt;if(!objReceipt)throw Error('The verified receipt is unavailable.');showPaidOrder(objReceipt,state.customer);document.getElementById('home-page').classList.add('hidden');document.getElementById('order-view').classList.remove('hidden');document.getElementById('order-hero').classList.remove('hidden');goTo(4);objPaymentMessage.textContent='Payment verified.';document.getElementById('auth-message').textContent='Payment verified. Your order has been saved.';objRetry.hidden=true;objResume.hidden=true;requestKey=null;sessionStorage.removeItem(strStorageKey);history.replaceState(null,'',location.pathname+'#order');}
async function checkStripePayment(){
 const objStored=readCheckout();if(!objStored){objPaymentMessage.textContent='This browser has no checkout access token. Sign in to view your orders, or contact the restaurant with your Stripe receipt. Do not pay again until the payment is checked.';return;}
 objRetry.disabled=true;try{const objResult=await paymentApi('/api/stripe/status',{requestKey:objStored.requestKey,checkoutToken:objStored.checkoutToken});if(objResult.state==='paid')showVerifiedReceipt(objResult);else{objPaymentMessage.textContent=objResult.state==='expired'?'Checkout expired without a confirmed payment. You can start a new order.':'Payment is not confirmed yet. Check again before paying again.';objRetry.hidden=false;}}catch(objError){objPaymentMessage.textContent=objError.message;objRetry.hidden=false;}finally{objRetry.disabled=false;}
}
objRetry.addEventListener('click',checkStripePayment);
async function beginStripeCheckout(objPayload){
 if(!bStripeAvailable)throw Error('Online payment is unavailable. Choose payment at pickup.');
 // The request key and secret survive a redirect but contain no card data or customer contact details.
 const objStored=readCheckout();let strToken;
 if(objStored?.requestKey===objPayload.requestKey)strToken=objStored.checkoutToken;
 else strToken=(crypto.randomUUID()+crypto.randomUUID()).replaceAll('-','');
 sessionStorage.setItem(strStorageKey,JSON.stringify({requestKey:objPayload.requestKey,checkoutToken:strToken}));
 const objResult=await paymentApi('/api/stripe/checkout',{...objPayload,checkoutToken:strToken});
 if(objResult.state==='paid'){showVerifiedReceipt(objResult);return;}
 const objUrl=new URL(objResult.url);if(objUrl.protocol!=='https:'||objUrl.hostname!=='checkout.stripe.com')throw Error('Checkout address could not be verified.');
 sessionStorage.setItem(strStorageKey,JSON.stringify({requestKey:objPayload.requestKey,checkoutToken:strToken,url:objUrl.href}));
 location.assign(objUrl.href);
}
async function initializeStripe(){
 try{const objResponse=await fetch('/api/stripe/config');const objConfig=await objResponse.json();bStripeAvailable=Boolean(objResponse.ok&&objConfig.enabled);if(bStripeAvailable){const objOption=document.createElement('option');objOption.value='online';objOption.textContent='Pay securely online with Stripe';objPaymentSelect.append(objOption);}}
 catch{bStripeAvailable=false;}
 const objQuery=new URLSearchParams(location.search);
 if(objQuery.get('checkout')==='success'){
  // Query parameters never prove payment. The server retrieves Stripe's session and verifies it.
  document.getElementById('auth-message').textContent='Checking your Stripe payment…';objRetry.hidden=false;
  document.getElementById('home-page').append(objPaymentMessage,objRetry);
  await checkStripePayment();
 }else if(objQuery.get('checkout')==='cancelled'){
  document.getElementById('home-page').append(objPaymentMessage,objRetry,objResume);objPaymentMessage.textContent='Checkout was left without confirmation. Your Stripe session may still be open. Check payment status before starting another payment.';objRetry.hidden=false;
  const objStored=readCheckout();try{const objUrl=new URL(objStored?.url);if(objUrl.protocol==='https:'&&objUrl.hostname==='checkout.stripe.com'){objResume.href=objUrl.href;objResume.hidden=false;}}catch{}
 }
}
initializeStripe();
