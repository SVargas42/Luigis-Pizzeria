export function requiresStaffAuthentication(objUrl){return objUrl.pathname.startsWith('/api/admin')||objUrl.pathname==='/admin'||objUrl.pathname.startsWith('/admin/');}
