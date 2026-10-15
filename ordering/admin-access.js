// Only the explicitly marked staff page is public; every staff API stays protected.
export function requiresStaffAuthentication(objUrl) {
  const bDemoPage = objUrl.pathname === '/admin' && objUrl.searchParams.get('demo') === '1';
  const bStaffPage = objUrl.pathname === '/admin' || objUrl.pathname.startsWith('/admin/');
  return objUrl.pathname.startsWith('/api/admin') || (bStaffPage && !bDemoPage);
}
