// Menu requests must pass website account authorization before using internal credentials.
export function createMenuProxy({resolveIdentity:fnIdentity,readBody:fnReadBody,fetch:fnFetch=globalThis.fetch,lifecycleUrl:strLifecycleUrl='http://127.0.0.1:8000',siteUrl:strSiteUrl,staffUser:strStaffUser,staffPassword:strStaffPassword}){
 const objBase=new URL(strLifecycleUrl),strOrigin=new URL(strSiteUrl).origin;
 if(objBase.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(objBase.hostname)||objBase.username||objBase.password||objBase.pathname!=='/'||objBase.search||objBase.hash)throw Error('Menu backend must use a loopback HTTP origin.');
 return async function forwardMenuRequest(objRequest,objUrl){
  const bCollection=objUrl.pathname==='/api/admin/menu';
  const bItem=/^\/api\/admin\/menu\/(pizza|topping|side|drink|drink_name)\/[^/]+$/.test(objUrl.pathname);
  if(!bCollection&&!bItem)return null;
  const objIdentity=await fnIdentity(objRequest);
  if(objIdentity?.role!=='admin')return {status:403,data:{error:'Administrator account required.'}};
  if(!(bCollection?['GET','POST']:['PATCH','DELETE']).includes(objRequest.method))return {status:405,data:{error:'Unsupported menu method.'}};
  if(objRequest.method!=='GET'&&objRequest.headers.origin!==strOrigin)return {status:403,data:{error:'Invalid request origin'}};
  if(!strStaffUser||!strStaffPassword)return {status:503,data:{error:'Menu service is unavailable.'}};
  let objInput;
  if(objRequest.method!=='GET'){
   try{objInput=await fnReadBody(objRequest);if(!objInput||typeof objInput!=='object'||Array.isArray(objInput))throw Error();}
   catch{return {status:400,data:{error:'Send a JSON object (maximum 32 KB).'}};}
  }
  try{
   const objResponse=await fnFetch(new URL(objUrl.pathname,objBase),{
    method:objRequest.method,redirect:'error',signal:AbortSignal.timeout(12000),
    headers:{'Content-Type':'application/json','X-Luigi-Actor':objIdentity.email,
     Authorization:'Basic '+Buffer.from(`${strStaffUser}:${strStaffPassword}`).toString('base64')},
    body:objInput?JSON.stringify(objInput):undefined,
   });
   return {status:objResponse.status,data:await objResponse.json()};
  }catch{return {status:503,data:{error:'Menu service is unavailable. Refresh the menu before retrying.'}};}
 };
}
