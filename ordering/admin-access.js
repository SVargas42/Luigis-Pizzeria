// Only the explicitly marked staff page is public; every staff API stays protected.
export function requiresStaffAuthentication(objUrl) {
  const bDemoPage = ['/admin','/admin/analytics'].includes(objUrl.pathname) && objUrl.searchParams.get('demo') === '1';
  const bStaffPage = ['/admin','/admin/analytics'].includes(objUrl.pathname) || objUrl.pathname.startsWith('/admin/');
  return objUrl.pathname.startsWith('/api/admin') || (bStaffPage && !bDemoPage);
}
