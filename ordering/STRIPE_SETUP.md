# Stripe payments: installation and release checks

This update includes the preceding account implementation because the saved VS Code project did not yet contain it. Keep your real .env. Copy matching files into the project and merge configuration; never paste secrets into HTML, public JavaScript, Git or chat.

## Implemented behavior

Pickup remains available. When STRIPE_ENABLED=1 and Stripe is correctly configured, the payment selector offers a Stripe-hosted card checkout. Your server prices the selections from MariaDB, snapshots the contact details, item prices and fixed tax, reserves account ownership, and creates a Checkout Session. Card details are entered on Stripe's hosted page and never stored by this app.

The browser's return URL does not prove payment. A raw-body signed webhook, or an authenticated-capability status request which retrieves the Session directly from Stripe, verifies mode, metadata, session ID, currency, amount and paid status. A locked MariaDB transaction creates exactly one paid, trackable order, its items/event, and one receipt-email outbox entry. Duplicate webhooks and concurrent return-page checks return the same receipt. Stripe idempotency keys prevent a network retry from creating another Checkout Session. Changed selections cannot silently overwrite a pending quote. Menu price changes do not change an already-created checkout or receipt.

Paid orders use the existing lifecycle staff queue, tracking stages, pickup estimate, customer account history, and admin analytics. Card receipts cannot be edited after payment. Cancelling or archiving an order does NOT refund its payment. Refunds are performed by an authorized Stripe operator in the Stripe Dashboard; refund webhooks synchronize paid/partially_refunded/refunded amounts. Disputes, payouts, fees and settlement reconciliation are handled in Stripe Dashboard and are not an accounting ledger in this application.

## Apply database changes

Back up the real database first. Apply 003_accounts.sql if the account upgrade is not already installed. The existing lifecycle migration 002_lifecycle.sql must already be applied. On a fresh database the sequence is schema.sql, 002_lifecycle.sql, 003_accounts.sql, 004_stripe.sql. On an existing lifecycle database do not re-run schema.sql because its old enum ALTER may narrow payment methods. From the repository root on Debian:

```bash
sudo mariadb luigis < ordering/db/003_accounts.sql  # Skip if already applied
sudo mariadb luigis < ordering/db/004_stripe.sql
sudo mariadb
```

Keep the privileges in ACCOUNTS_RELEASE.md and the existing order/customer/menu permissions. Add:

```sql
GRANT SELECT,INSERT,UPDATE ON luigis.stripe_payments TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT ON luigis.stripe_events TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,UPDATE ON luigis.stripe_refunds TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,UPDATE ON luigis.checkout_reservations TO 'luigis_app'@'127.0.0.1';
EXIT;
```

The receipt outbox uses account_mail, including the new purpose column in 004_stripe.sql. Registration/invites still use expiring account links. Payment receipts are not expired as account-verification links. Resend configuration from the account update is used for itemized receipts with tracking links; failures retry and are visible in account_mail. Stripe also receives receipt_email. Never log the receipt tracking token or contact details. Configure the Python SMTP receipt delivery for pickup orders. Its failure logs now omit customer details and tracking links; pickup SMTP failures do not have durable retries, so verify delivery and monitor failures before public launch.

## Configure Stripe sandbox first

Use a Stripe account's sandbox/test API secret and endpoint signing secret. In ordering/.env, merge:

```dotenv
SITE_URL=https://your-real-website.example
STRIPE_ENABLED=1
STRIPE_MODE=test
STRIPE_SECRET_KEY="sk_test_REPLACE_WITH_REAL_TEST_KEY"
STRIPE_WEBHOOK_SECRET="whsec_REPLACE_WITH_ENDPOINT_SECRET"
TAX_BASIS_POINTS=0
```

Use the exact SITE_URL origin already configured for accounts. For local development only, http://127.0.0.1:3000 is supported. A publishable key is not required for this hosted Checkout implementation. The fixed tax basis points MUST match the Python service; 825 means 8.25%. Tax is configured here, not automatically determined by Stripe Tax; confirm the company's actual tax policy before launch.

In Stripe Workbench/Dashboard, create a webhook endpoint at:

```text
https://your-real-website.example/api/stripe/webhook
```

Subscribe to:

- checkout.session.completed
- checkout.session.async_payment_succeeded
- checkout.session.async_payment_failed
- checkout.session.expired
- charge.refunded
- refund.created
- refund.updated
- refund.failed

Checkout currently accepts cards only. Delayed-payment events are handled defensively, but other payment method types are not enabled. The signing secret belongs to this specific endpoint/environment and is different from the API key. Forward raw request bytes unchanged; do not parse/re-serialize the webhook in nginx or another proxy. Only the signed webhook bypasses the normal browser Origin check.

For a local test server, Stripe CLI can forward events:

```bash
stripe listen --forward-to http://127.0.0.1:3000/api/stripe/webhook
```

Use the CLI's displayed signing secret for that local session. Enable public HTTPS, preserve Host, overwrite X-Real-IP if using the account proxy option, and keep Node, Python and MariaDB on private/loopback listeners as described in ACCOUNTS_RELEASE.md. The Checkout redirect uses Stripe's default checkout.stripe.com domain; custom Checkout domains are not configured.

## Install, test and run

```bash
cd ordering
npm ci --ignore-scripts
npm test
RUN_DB_TEST=1 node --env-file=.env --test test/database.live.test.js test/accounts.live.test.js test/payments.live.test.js
npm start
```

The locked dependencies include the official Stripe Node SDK. Default tests use offline provider/database adapters and the real SDK's webhook signing checks; they do not charge a card. The three live tests use the configured MariaDB account and roll their records back. payments.live.test.js uses an offline Stripe provider to test actual MariaDB payment SQL and transactions; it is not a real Stripe sandbox end-to-end payment.

Before enabling live payments, test with Stripe's documented sandbox cards through the real hosted page: successful payment, declined card, authentication/3DS, leaving Checkout, expired Checkout, repeated clicks, webhook replay, browser closed before return, temporary database outage then webhook retry, and signed-in/guest checkout. Confirm exactly one order, correct account ownership, matching subtotal/tax/total, paid state, tracker, queue, receipt email, and persistence after restart. Test partial/full refund and failed refund webhooks. Verify invalid signatures and a forged success URL cannot create an order. Do not use real card details in sandbox tests.

Clear or reconcile any older pending_checkouts sessions/intents from the pre-account Stripe fragments before switching. The old payment-intent/checkout endpoints return 410 and this integration ignores events without luigi-checkout-v2 metadata; it does not silently migrate old in-flight money.

## Reconciliation and operations

Schedule this on the Debian server, for example every five minutes:

```bash
node --env-file=.env scripts/reconcile-stripe.js
```

An advisory lock prevents overlapping reconciliation runs. It checks existing open/creating payments and recovers paid orders if a redirect or webhook was missed. Monitor script failures, webhook failures, unmatched Stripe payments and the email outbox. If a Session was created but its ID was lost before database update, recover using its real ID from Stripe Dashboard:

```bash
node --env-file=.env scripts/reconcile-stripe.js cs_test_ACTUAL_SESSION_ID
```

The recovery command retrieves and validates the real Session and its stored quote. It never creates a charge. Do not delete quotes or access records while payment/recovery/refunds may still need them. Apply a company-approved encrypted-backup and personal-data retention policy. Logs identify payment record IDs, not card data or secret keys. Reconciliation of refunds is event-driven; monitor webhook delivery and Stripe Dashboard for missing/failed refund updates and disputes.

Guest receipt access requires the random token saved in the originating browser's sessionStorage. The token contains no card/contact details. If the browser session is lost, use the emailed receipt/tracker or restaurant support; a Session ID alone does not disclose customer data. Signed-in users can view paid orders through their account after fulfillment. Returning from the cancel link does not guarantee the provider Session is cancelled: the customer can resume the same Session or wait for its one-hour expiry. Do not start another payment until the first is checked.

Set STRIPE_MODE=live with matching live secret and live endpoint signing secret only after sandbox and database checks pass and Stripe onboarding is complete. Live card payment is not verified by unit tests. Keep production secrets server-only. Actual go-live still requires operational review, HTTPS, configured receipt email, tax policy, backups and monitoring.

STRIPE_ENABLED=0 pauses new card checkout but does not stop verified webhooks, status checks or reconciliation while valid Stripe keys remain configured. Keep the keys and webhook endpoint active until all in-flight payments/refunds are resolved. A request key is reserved to pickup or Stripe, never both: switching payment methods after an attempt requires a fresh order key after checking the previous payment.

References: [Stripe fulfillment](https://docs.stripe.com/checkout/fulfillment), [official Node SDK and raw-body signatures](https://github.com/stripe/stripe-node), [Stripe refunds](https://docs.stripe.com/refunds), [idempotent API requests](https://docs.stripe.com/api/idempotent_requests).
