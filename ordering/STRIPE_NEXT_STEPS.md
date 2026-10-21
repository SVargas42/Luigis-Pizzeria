# Stripe setup for luigispizza.duckdns.org

The backend/database already support Stripe-hosted card checkout. A Stripe account has not been supplied, so no real provider payment, webhook delivery or refund test is complete. Keep STRIPE_ENABLED=0 until sandbox credentials and the test plan are ready. Account creation, identity/business details and live activation require the account owner.

1. Create your account at https://dashboard.stripe.com/register . Use accurate owner/business information. For development use a sandbox; do not enter real card details into sandbox checkout. Live activation is a later operator step.
2. In the sandbox API keys area, obtain its server secret API key (sk_test_...). This app currently expects that key type. Keep it private, never in browser JavaScript or Git. The hosted Checkout redirect does not require a publishable key.
3. In Workbench > Webhooks create an event destination for your account, using **Snapshot** payloads, at https://luigispizza.duckdns.org/api/stripe/webhook . This integration handles snapshot event objects, not thin events. Subscribe to checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired, charge.refunded, refund.created, refund.updated and refund.failed. Obtain the endpoint's whsec_ signing secret; it is separate from the API key.
4. In browser SSH enter the secrets without echo:

```bash
cd /opt/luigis/ordering
sudo python3 scripts/configure-stripe.py /etc/luigis.env
sudo -u luigis /usr/local/bin/node --env-file=/etc/luigis.env scripts/verify-stripe.js
```

The helper only accepts sandbox keys, preserves unrelated secrets and leaves checkout disabled. The verifier makes a read-only API request; it does not create a charge or prove webhook delivery. Do not paste keys into chat.

5. After credentials are valid, follow STRIPE_SETUP.md's sandbox plan. Set STRIPE_ENABLED=1 while STRIPE_MODE=test only when you are ready to expose the test checkout, restart luigis, and test the actual hosted page using Stripe test cards. Do not advertise this test mode as accepting real payment. Verify the signed webhook, exactly one paid order, retries, receipts, tracker, account history, preparation queue, partial/full refunds and failure recovery. Configuring Gmail successfully is necessary for receipts.
6. Only after sandbox checks, actual business tax settings and Stripe live onboarding are complete should the owner configure matching live credentials and authorize real card processing. The sandbox-only helper intentionally rejects live keys.

The reconciliation systemd unit/timer may be prepared disabled. Enable it after keys are configured and sandbox checks are underway. It recovers existing paid checkouts; it never initiates a new charge. Use the real account's delivery logs to check webhook failures. Reconciliation/refund operations do not replace an accounting ledger.

References: https://docs.stripe.com/keys ; https://docs.stripe.com/webhooks ; https://docs.stripe.com/testing ; ordering/STRIPE_SETUP.md.
