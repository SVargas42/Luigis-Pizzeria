# Debian deployment result — October 20, 2026

Website: https://luigispizza.duckdns.org
GCP VM: luigispizza, project luigis-pizza-510916, zone us-east4-b.

## Actual production paths

- Application: `/opt/luigis` (not the home-directory example in the generic setup guide).
- Shared production environment: `/etc/luigis.env`, root-owned, group luigis, mode 0640. Both backend services read it. The VM does not use your Windows `.env`.
- Node service: `luigis.service`; Python service: `luigis-lifecycle.service`.
- Node: `/usr/local/bin/node`; Python environment: `/opt/luigis-lifecycle-venv`.
- Nginx and the existing Certbot HTTPS configuration were preserved.
- MariaDB database: `luigis`; runtime login: `luigis_app` at 127.0.0.1.
- Pre-deployment application/config/database backups: `/var/backups/luigis/deploy-20261020-052205`.
- Daily database backups: `/var/backups/luigis/daily`; systemd timer `luigis-db-backup.timer`. First compressed backup passed gzip validation. Backups remain on the same VM; encrypted off-VM copies and restore/retention policy still need configuration.

## Completed

Uploaded and checksum-verified the full release, staged and installed it into the existing application. Preserved all five existing orders. Applied only migrations 003_accounts.sql and 004_stripe.sql because the base schema and lifecycle migration were already present. Applied runtime table permissions. Updated the shared environment's public origin and private backend addresses while preserving passwords. Installed locked Node dependencies and Python test dependencies. Corrected Node executable permissions so its test subprocesses can run. Corrected the live payment test's simulated payment-intent ID to use valid ID syntax; payment verification itself was not relaxed.

All four existing services (MariaDB, Nginx, Node, Python) were active after deployment. Node port 3000, Python port 8000 and MariaDB port 3306 listen only on 127.0.0.1. Enabled and exercised the daily database backup timer. Existing Certbot renewal timer is present.

## Verification

- 74 regular Node tests passed; three live tests were skipped in that regular run.
- All three live MariaDB tests then passed: base orders/foreign keys/rollback; account sessions/ownership; payment fulfillment/outbox/idempotency/rollback.
- 11 Python tests passed; dependency and SQLite adapter deprecation warnings remain.
- Public HTTPS `/`, `/account`, `/api/menu`, `/api/session`: 200.
- Guest `/admin`: 303 redirect to sign-in.
- Guest admin orders and analytics APIs: 403.
- Browser write with a nonmatching Origin: 403.
- Public HTTP redirects to HTTPS with 301.

The live payment database test uses a simulated Stripe provider with real MariaDB. No real Stripe sandbox payment or real email delivery was tested. No customer test records were deliberately left behind by the transactional tests.

## Remaining operator setup

There are zero active website administrators. Create the first admin yourself in browser SSH so you choose and enter the private website password:

```bash
cd /opt/luigis/ordering
sudo -u luigis /usr/local/bin/node --env-file=/etc/luigis.env scripts/create-admin.js
```

Sign in at https://luigispizza.duckdns.org/account then open /admin. The shared environment's ADMIN_USER / ADMIN_PASSWORD are internal service credentials, not a website login.

Account mail and pickup SMTP are not configured. Edit the production file with `sudo nano /etc/luigis.env` and supply RESEND_API_KEY, ACCOUNT_MAIL_FROM, SMTP_HOST, SMTP_PORT, SMTP_FROM, SMTP_USER and SMTP_PASSWORD from verified email providers. Do not post credentials in chat. DuckDNS hosting does not automatically provide a verified email sender. Registration/recovery remain unavailable until account mail is configured. Pickup orders commit even if receipt SMTP fails; pickup mail currently has no durable retry queue.

Confirm actual menu prices and TAX_BASIS_POINTS before real orders. Stripe remains disabled until matching real sandbox keys/webhook secrets and end-to-end payment/refund tests are configured. The webhook address is https://luigispizza.duckdns.org/api/stripe/webhook . Review STRIPE_SETUP.md before enabling it.

After editing the production env:

```bash
sudo systemctl restart luigis-lifecycle luigis
sudo /usr/local/bin/node --env-file=/etc/luigis.env /opt/luigis/ordering/deploy/check-env.js
```

Once email/admin are configured, verify actual registration, verification, recovery, staff invitations, pickup receipt, tracker, customer history isolation and authenticated admin queue/analytics through the browser. These cannot be claimed complete solely from offline and database tests.

Schedule the existing account-maintenance command daily according to the company's retention policy; schedule Stripe reconciliation every five minutes once Stripe credentials are configured. No data-retention deletion policy was imposed during this deployment.

For future updates preserve `/etc/luigis.env` and existing Nginx HTTPS blocks. Restart `luigis`, not `luigis-web`. Apply only new migrations after a backup. Keep production secrets out of uploaded source packages.
