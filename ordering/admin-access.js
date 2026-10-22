export function requiresStaffAuthentication(objUrl){return objUrl.pathname.startsWith('/api/admin')||objUrl.pathname==='/admin'||objUrl.pathname.startsWith('/admin/')||objUrl.pathname==='/staff'||objUrl.pathname.startsWith('/api/employee');}

export function canAccessStaffRoute(strRole,objUrl,strMethod='GET'){
 if(!requiresStaffAuthentication(objUrl))return false;
 if(strRole==='admin')return true;
 if(strRole!=='worker')return false;
 const strPath=objUrl.pathname;
 // An explicit allowlist keeps new staff/management endpoints admin-only by default.
 return (strMethod==='GET'&&(strPath==='/staff'||strPath==='/api/employee/orders/active'))
  ||(strMethod==='PATCH'&&/^\/api\/employee\/orders\/[1-9][0-9]*\/(status|estimate)$/.test(strPath))
  ||(strMethod==='POST'&&/^\/api\/employee\/orders\/[1-9][0-9]*\/complete$/.test(strPath));
}
