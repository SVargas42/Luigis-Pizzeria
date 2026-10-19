// server.js installs the database session resolver from accounts.js at startup.
// Fail closed if a tool imports this module without installing a resolver.
let fnIdentityResolver = async () => null;
let bIdentityConfigured = false;

export function setIdentityResolver(fnResolver) {
  if (typeof fnResolver !== 'function') throw new TypeError('Identity resolver must be a function.');
  fnIdentityResolver = fnResolver;
  bIdentityConfigured = true;
}

export function identityIsConfigured() {
  return bIdentityConfigured;
}

export async function resolveIdentity(objRequest) {
  const objIdentity = await fnIdentityResolver(objRequest);
  if (!objIdentity || typeof objIdentity !== 'object') return null;
  if (!['customer', 'admin'].includes(objIdentity.role)) return null;
  if (typeof objIdentity.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(objIdentity.email.trim())) return null;

  return {
    id: String(objIdentity.id || objIdentity.email.trim().toLowerCase()),
    role: objIdentity.role,
    email: objIdentity.email.trim().toLowerCase(),
    firstName: typeof objIdentity.firstName === 'string' ? objIdentity.firstName.trim().slice(0, 80) : '',
    lastName: typeof objIdentity.lastName === 'string' ? objIdentity.lastName.trim().slice(0, 80) : '',
    phone: typeof objIdentity.phone === 'string' ? objIdentity.phone.trim().slice(0, 30) : ''
  };
}
