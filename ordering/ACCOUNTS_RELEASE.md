# Account integration and release verification

The subsequent STRIPE_SETUP.md supersedes the payment-disabled statements below. Apply the combined update and 004_stripe.sql before running this version.

## Implemented

Customer registration requires first name, last name, email, phone (7–15 digits), and a 12–128 character password. Passwords are salted and hashed with scrypt. Email verification is required before login. Staff accounts are created by a local bootstrap command or by a verified admin's invitation, never through a public role selector. Invitations, verification links, and password reset links expire after one hour and are single-use.

Email ownership is verified. Phone is mandatory and format-validated; SMS ownership verification is not implemented. Provide accurate contact/privacy language before launch.

Sessions are random opaque tokens, hashed in MariaDB, HttpOnly, SameSite=Lax, and Secure on HTTPS. Sessions expire after eight hours. Logout, password changes/recovery, account disabling and role changes revoke access. Sensitive administrator changes require the current password; self-demotion/disabling is blocked. Account audit entries record registration, login, invitations and administration. Persistent per-email/per-IP throttling limits authentication attempts. Do not run Node directly on the public Internet: reverse-proxy rate limits are still needed against traffic floods.

Customer history uses account_order_claims linked to orders.request_key, not customer email. This prevents someone registering an old guest's email from taking that guest's order history. New authenticated orders are reserved to the account before checkout. Account profile details override browser-submitted contacts. Admins retain access to all existing orders. Email addresses cannot be changed through the profile screen; a separately verified email-change workflow is intentionally not implemented.

Admin reports now calculate actual order/item/event data. Cancelled orders are excluded from order value and quantities. UTC dates are used and missing days are zero-filled. Business totals are non-cancelled order value, not settled revenue or accounting profit. Staff reports count distinct orders with recorded actor status updates; old unattributed actions are excluded. Shift hours, schedules and prep duration are not measured and are shown as not recorded. These are not fabricated metrics.

## Files to apply

This package keeps the original folder structure. New runtime files: ordering/accounts.js, ordering/analytics.js, ordering/public/account.html, ordering/public/account.js, ordering/scripts/create-admin.js, ordering/scripts/account-maintenance.js and ordering/db/003_accounts.sql. Updated runtime files: index.html, ordering/server.js, ordering/admin-access.js, ordering/public/admin.html, and ordering/lifecycle/app.py. Updated and added tests are under ordering/test. Your real .env is not included and must be preserved.

## Database migration on Debian

Back up the live database before migration. Preserve the existing schema and lifecycle migration: do not re-run schema.sql over a populated lifecycle database because its historical payment_method ALTER may narrow the enum. On a NEW database, run schema.sql, then 002_lifecycle.sql, then 003_accounts.sql. On an existing database with lifecycle columns, apply only 003_accounts.sql:

```bash
cd /path/to/Luigis-Pizzeria
sudo mariadb luigis < ordering/db/003_accounts.sql
sudo mariadb
```

Grant the runtime account access to the new tables and the event/item operations used by existing admin workflows:

```sql
GRANT SELECT,INSERT,UPDATE ON luigis.accounts TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,DELETE ON luigis.account_sessions TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,DELETE ON luigis.account_actions TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,UPDATE ON luigis.account_order_claims TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,UPDATE,DELETE ON luigis.account_mail TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,UPDATE,DELETE ON luigis.account_throttles TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT ON luigis.account_audit TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT ON luigis.order_events TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,DELETE ON luigis.order_items TO 'luigis_app'@'127.0.0.1';
EXIT;
```

The existing customers/orders/menu grants must remain. Configure the Python service's credentials to match Node's ADMIN_USER / ADMIN_PASSWORD for internal forwarding. Those values no longer grant website admin access. Bind the Python service ONLY to 127.0.0.1:8000 and never expose it through GCP firewall or a catch-all proxy; it trusts this private boundary. Forward all public API calls through Node, which checks the verified account and exact Origin.

## Environment and first administrator

Merge the new settings from .env.example into your existing .env. Keep DB_PASSWORD. Set SITE_URL to the actual HTTPS origin, RESEND_API_KEY to an account-email API key, and ACCOUNT_MAIL_FROM to an address on your verified sending domain. Existing receipt-email service configuration stays separate. Registration and recovery return service-unavailable until email is configured. No account email is sent during automated unit tests.

```bash
cd ordering
npm install --ignore-scripts
node --env-file=.env scripts/create-admin.js
```

The command prompts for name, email, phone, and a hidden password. Run from a trusted interactive terminal. The first admin email is treated as locally verified by the operator. It refuses to create another admin once an active admin exists; use /admin/accounts invitations afterward. No default accounts or passwords are shipped.

```bash
npm test
RUN_DB_TEST=1 node --env-file=.env --test test/database.live.test.js test/accounts.live.test.js
npm start
```

Restart Node and the Python lifecycle service after applying changes. Log in at /account; admins can use /admin, /admin/analytics and /admin/accounts. Use /account?mode=register for signup. Run the maintenance command daily with a service timer:

Behind nginx on the same machine, configure `proxy_set_header X-Real-IP $remote_addr;` (overwrite client input), keep Node bound to loopback, and set `TRUST_PROXY_LOOPBACK=1`. Otherwise all clients appear to have the proxy's IP and share one login throttle. Never trust a client-controlled forwarded IP from a public listener. Use `proxy_set_header Host $host;` and preserve the production origin from the browser. Use HTTPS with SITE_URL matching that origin exactly.

```bash
node --env-file=.env scripts/account-maintenance.js
```

Mail is delivered by a durable outbox worker in the Node service; transient failures retry every five minutes, up to ten attempts. Monitor failures:

```sql
SELECT id,recipient,attempts,next_attempt_at FROM account_mail WHERE sent_at IS NULL;
```

Messages contain sensitive one-time links until delivered; database/backups require restricted access and encryption. Agree audit and personal-data retention periods with the company. Accounts can be disabled, not erased; data-erasure tooling and policy require a separate product decision.

## Release gates still requiring the actual environment

This is an implementation, not proof of a production deployment. Before release: apply/verify migrations against a restored backup; pass both live database tests with the runtime account; verify HTTPS cookies/Origin with the real reverse proxy; send and redeem actual verification/invitation/reset emails; test customer A cannot view customer B history; verify an order still appears after both services restart; verify lifecycle staff updates record actor_email; test email failure/retry, logout, password reset, and disabling an already-signed-in account; check mobile and keyboard/screen-reader flows; configure encrypted backups, health checks, and request throttling. Review the security configuration before handling real customers. MFA is not implemented; consider it for administrators.

Local verification: 50 Node tests passed, two live MariaDB tests skipped; 10 Python lifecycle tests passed. JavaScript syntax and Python compilation checks passed. Python's existing SQLite adapter and the installed test client's httpx integration emit deprecation warnings; these did not fail tests and should be modernized before future dependency upgrades. Account service workflow tests use a transactional test store; they do not prove MariaDB behavior. No live email was sent during tests.

The existing online option was a mock payment. It has been removed from checkout and direct mock-online submissions are rejected. The legacy Stripe endpoints are disabled, while webhook handling remains for old in-flight payments. Do not advertise online payment until a separately verified paid checkout/refund flow is complete. Pickup payment remains supported. Product descriptions are the historical item source for reports; a normalized product/SKU catalogue would be needed if menu names change frequently. Profile changes affect future orders, not past receipts. No guest history is automatically claimed.
