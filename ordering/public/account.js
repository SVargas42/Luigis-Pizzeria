const $=strId=>document.getElementById(strId);
const objQuery=new URLSearchParams(location.search),objFragment=new URLSearchParams(location.hash.slice(1));
const strToken=objFragment.get('token')||'';
const strMode=objFragment.get('action')||objQuery.get('mode')||'login';
if(location.hash)history.replaceState(null,'',location.pathname+location.search);
let strSelectedId=null;
function announce(strText){$('message').textContent=strText;}
function showRegistrationAlert(strText, bSuccess) {
  const objAlert = $('register-alert');
  objAlert.textContent = `${bSuccess ? 'Success' : 'Error'}: ${strText}`;
  objAlert.className = `alert ${bSuccess ? 'alert-success' : 'alert-danger'}`;
  objAlert.focus();
}
function normalizePhone(strValue){let strDigits=strValue.replace(/\D/g,'');if(strDigits.length===11&&strDigits.startsWith('1'))strDigits=strDigits.slice(1);strDigits=strDigits.slice(0,10);if(!strDigits)return '';if(strDigits.length<=3)return `(${strDigits}`;if(strDigits.length<=6)return `(${strDigits.slice(0,3)}) ${strDigits.slice(3)}`;return `(${strDigits.slice(0,3)}) ${strDigits.slice(3,6)}-${strDigits.slice(6)}`;}
async function api(strPath,objBody){const objResponse=await fetch(strPath,objBody===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(objBody)});const objData=await objResponse.json();if(!objResponse.ok)throw Error(objData.error||'Request failed. Please retry.');return objData;}
function textCell(strValue){const objCell=document.createElement('td');objCell.textContent=String(strValue);return objCell;}
async function loadAccounts(){try{const arrAccounts=await api('/api/admin/accounts');$('accounts').replaceChildren();for(const objAccount of arrAccounts){const objRow=document.createElement('tr');objRow.append(textCell(`${objAccount.first_name} ${objAccount.last_name}`),textCell(`${objAccount.email} / ${objAccount.phone}`),textCell(objAccount.role),textCell(objAccount.disabled_at?'Disabled':objAccount.email_verified_at?'Verified':'Awaiting verification'));const objCell=document.createElement('td'),objButton=document.createElement('button');objButton.type='button';objButton.textContent='Edit '+objAccount.email;objButton.onclick=()=>{strSelectedId=String(objAccount.id);$('selected-account').textContent=objAccount.email;$('update-role').value=objAccount.role;$('update-disabled').value=String(Boolean(objAccount.disabled_at));$('update-form').hidden=false;$('update-role').focus();};objCell.append(objButton);objRow.append(objCell);$('accounts').append(objRow);}}catch(objError){announce(objError.message);}}
async function init(){
 try{
  const objSession=await api('/api/session');
  if(objSession.authenticated){$('signed-in').hidden=false;$('identity').textContent=`${objSession.user.firstName} ${objSession.user.lastName} · ${objSession.user.email}`;for(const strId of ['admin-link','analytics-link','accounts-link'])$(strId).hidden=objSession.user.role!=='admin';if(objSession.user.role==='worker'){$('admin-link').hidden=false;$('admin-link').href='/staff';$('admin-link').textContent='Kitchen order queue';}}
  if(location.pathname==='/admin/accounts'){if(objSession.user?.role!=='admin')throw Error('Sign in with an administrator account.');$('management').hidden=false;$('title').textContent='Manage accounts';await loadAccounts();return;}
  if(strMode==='verify'){$('title').textContent='Verify email';announce((await api('/api/auth/verify',{token:strToken})).message);return;}
  if(!['login','register','forgot','resend','reset','invite','profile','password'].includes(strMode))throw Error('Choose a valid account action.');
  if(['profile','password'].includes(strMode)&&!objSession.authenticated)throw Error('Sign in to update your account.');
  const objTitles={login:'Sign in',register:'Create account',forgot:'Reset password',resend:'Resend verification',reset:'Choose a new password',invite:'Accept staff invitation',profile:'Your profile',password:'Change password'};
  $('title').textContent=objTitles[strMode];$('account-form').hidden=false;$('submit').textContent=objTitles[strMode];
  const bProfile=['register','profile'].includes(strMode),bPassword=['login','register','reset','invite','password'].includes(strMode),bEmail=['login','register','forgot','resend'].includes(strMode);
  $('profile-fields').hidden=!bProfile;for(const strId of ['firstName','lastName','phone'])$(strId).required=bProfile;
  $('email-field').hidden=!bEmail;$('email').required=bEmail;$('password-field').hidden=!bPassword;$('password').required=bPassword;$('password').autocomplete=strMode==='login'?'current-password':'new-password';if(bPassword&&strMode!=='login')$('password').minLength=12;
  const bConfirmPassword = ['register', 'reset'].includes(strMode);
  $('confirm-password-field').hidden = !bConfirmPassword;
  $('confirmPassword').required = bConfirmPassword;
  $('confirm-password-label').textContent = strMode === 'reset' ? 'Confirm New Password' : 'Confirm Password';
  $('current-field').hidden=strMode!=='password';$('currentPassword').required=strMode==='password';
  $('instructions').textContent=strMode==='register'?'All fields are required. We use your name, email, and phone to manage your account and fulfill orders. Verify your email before signing in.':strMode==='profile'?'Update your name and phone. Email changes require restaurant support.':'Use the email address associated with your account.';
  if (strMode === 'reset') $('instructions').textContent = 'Enter your new password below.';
  if(strMode==='profile')for(const strId of ['firstName','lastName','phone'])$(strId).value=strId==='phone'?normalizePhone(objSession.user.phone):objSession.user[strId];
 }catch(objError){announce(objError.message);}
}
$('account-form').onsubmit=async objEvent=>{
 objEvent.preventDefault();
 if (strMode === 'reset') {
  const objAlert = $('reset-alert');
  objAlert.className = 'alert d-none';
  if ($('password').value !== $('confirmPassword').value) {
   objAlert.textContent = 'Passwords do not match.';
   objAlert.className = 'alert alert-danger';
   objAlert.focus();
   return;
  }
 }
 if (strMode === 'register' && $('password').value !== $('confirmPassword').value) {
  showRegistrationAlert('Passwords do not match.', false);
  $('register-alert').textContent = 'Passwords do not match.';
  return;
 }
 if(!$('account-form').reportValidity())return;$('submit').disabled=true;
 try{
  const objInput={email:$('email').value,firstName:$('firstName').value,lastName:$('lastName').value,phone:$('phone').value,password:$('password').value,currentPassword:$('currentPassword').value,token:strToken};
  const strEndpoint={register:'register',login:'login',forgot:'forgot',resend:'resend',reset:'reset',invite:'accept-invite',profile:'profile',password:'password'}[strMode];
  if (strMode === 'register') {
    $('register-alert').classList.add('d-none');
    const objResponse = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(objInput)
    });
    const objData = await objResponse.json();
    const bSuccess = objResponse.status === 201;
    showRegistrationAlert(
      bSuccess
        ? objData.message || 'Account created. Check your email for verification.'
        : objData.error || 'Registration failed. Please retry.',
      bSuccess
    );
    if (bSuccess) {
      $('password').value = '';
      $('confirmPassword').value = '';
      $('account-form').hidden = true;
    }
    return;
  }
  const objResult=await api('/api/auth/'+strEndpoint,objInput);$('password').value='';$('currentPassword').value='';announce(objResult.message||'Signed in.');
  if (strMode === 'reset') $('confirmPassword').value = '';
  if(strMode==='login'){const strNext=objQuery.get('next');location.assign(['/staff','/admin','/admin/analytics','/admin/accounts'].includes(strNext)?strNext:objResult.user?.role==='worker'?'/staff':'/');}
  else if(strMode!=='profile'){$('account-form').hidden=true;$('title').focus();}
 }catch(objError){
  if (strMode === 'register') showRegistrationAlert('Unable to complete registration. Please retry.', false);
  else announce(objError.message);
 }finally{$('submit').disabled=false;}
};
$('phone').addEventListener('input',objEvent=>{objEvent.target.value=normalizePhone(objEvent.target.value);});
$('invite-phone').addEventListener('input',objEvent=>{objEvent.target.value=normalizePhone(objEvent.target.value);});
$('logout').onclick=async()=>{try{await api('/api/auth/logout',{});location.assign('/');}catch(objError){announce(objError.message);}};
$('refresh').onclick=loadAccounts;
$('invite-form').onsubmit=async objEvent=>{objEvent.preventDefault();const objButton=$('invite-form').querySelector('button');objButton.disabled=true;try{const objResult=await api('/api/admin/accounts/invite',{firstName:$('invite-first').value,lastName:$('invite-last').value,email:$('invite-email').value,phone:$('invite-phone').value,role:$('invite-role').value,currentPassword:$('invite-password').value});$('invite-form').reset();announce(objResult.message);await loadAccounts();}catch(objError){announce(objError.message);}finally{$('invite-password').value='';objButton.disabled=false;}};
$('update-form').onsubmit=async objEvent=>{objEvent.preventDefault();const objButton=$('update-form').querySelector('button');objButton.disabled=true;try{const objResult=await api('/api/admin/accounts/update',{id:strSelectedId,role:$('update-role').value,disabled:$('update-disabled').value==='true',currentPassword:$('update-password').value});announce(objResult.message);$('update-form').hidden=true;await loadAccounts();}catch(objError){announce(objError.message);}finally{$('update-password').value='';objButton.disabled=false;}};
init();
