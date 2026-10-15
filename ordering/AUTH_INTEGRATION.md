# Authentication handoff contract

Authentication itself is intentionally not implemented in this ordering app. Until the account provider is connected, visitors can order as guests; the sign-in and create-account buttons show that account access is awaiting the teammate-owned integration.

## Browser handoff

The page emits `luigi:auth-request` with `event.detail.action` set to `sign-in` or `create-account`. The authentication UI should handle that event and, after it has verified the session with the server, emit `luigi:auth-state` with this shape:

```js
window.dispatchEvent(new CustomEvent('luigi:auth-state', {
  detail: {
    authenticated: true,
    authReady: true,
    user: { id: 'account-id', role: 'customer', email: 'person@example.com', firstName: 'First', lastName: 'Last', phone: '' }
  }
}));
```

Use `role: 'admin'` for staff accounts. A signed-in session hides the guest “Your Details” step and uses the account name/email. It reveals the Orders button; admin accounts also see the Analytics shortcut. A sign-out event should emit `luigi:auth-state` with `{authenticated:false,authReady:true}`.

The page exposes `window.LuigiPizzeriaIntegration.acceptAuthState(session)` for an adapter that prefers a direct method call. This only updates the page. It does not authenticate a user or grant API access.

## Server handoff

`GET /api/session` reports the session resolver result. The server's protected customer order-history API and signed-in order identity use the resolver in `ordering/identity.js`. The auth teammate should install a resolver during server startup using `setIdentityResolver` and verify the provider's signed, same-origin session cookie on every request. Return a trusted object with `id`, `role`, `email`, `firstName`, `lastName`, and `phone`. Do not accept identity, email, or role from a browser header/body as proof of authentication. Server roles are limited to `customer` and `admin`.

The resolver is deliberately a guest-only stub until that work is connected. With the stub, signed-in history returns 401 and guest checkout remains enabled. Staff APIs retain the current server-side staff credential fallback until account roles are wired in.

Names and email must be available from the verified account profile before account checkout. The server replaces submitted customer details with those verified profile fields. The customer order-history API scopes results to the resolver's verified email; no public order lookup by order number or email is exposed.
