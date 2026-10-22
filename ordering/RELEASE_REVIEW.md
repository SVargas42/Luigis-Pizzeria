# Release review — 21 October 2026

## Fixed in this update

- Tracker matches the main site's cream, tomato, basil and serif-heading style; desktop stage cards stack on phones.
- Ready orders keep polling for pickup completion. Completed/cancelled orders stop polling. Cancelled orders no longer show an active preparation stage.
- Account order history gives cancelled status precedence over an older tracking stage.
- Root, account and tracker pages include native keyboard-accessible footer disclosures: ingredient/allergen awareness, ordering/payment behavior and privacy information. No unverified per-item allergen matrix, invented refund promise or copied Domino's legal text is included.

## Major outstanding launch gates

1. Complete a real Stripe sandbox hosted checkout, verify a successful signed webhook and exactly one paid order, check account ownership/receipt/tracker/admin queue, replay webhook and test declined/3DS payments plus partial/full refunds. API login and reaching Checkout do not prove payment fulfillment.
2. Keep real payment disabled until business onboarding, company tax settings, matching live credentials/webhook and sandbox checks are complete. The public URL can currently expose sandbox checkout; real visitors must not mistake sandbox payments for paid restaurant orders.
3. Verify order receipt and every progress notification actually arrive in an inbox after the deployed mail fix. Monitor failed/exhausted account_mail rows. Gmail accepted SMTP earlier, but SMTP cannot guarantee inbox placement or exactly-once delivery.
4. VM lifecycle/menu code is older than the VS Code version. The focused VM notification suite passes, but current local menu tests reveal an inactive-drink-name gap in the older VM version. Deploy matching code, migrations and grants as a separate tested release; do not overwrite the VM blindly or rerun schema.sql over an existing database.
5. Daily same-VM backups exist; encrypted off-VM backups, a restore drill and a retention policy still need operator confirmation. A lost VM can also lose its local backups.
6. Confirm the first administrator can sign in and that customer/guest sessions cannot read staff data. The last explicit admin count before bootstrap was zero; do not infer that account creation happened from instructions alone.
7. Restaurant operator must supply business identity/contact details, jurisdiction, actual refunds/cancellation terms, verified ingredient/allergen information, data retention and privacy-request contact. The informational footer is not a completed jurisdiction-specific legal policy or verified allergen chart.

## PayPal decision

Stripe's current PayPal availability is for businesses in supported European countries, Liechtenstein, Norway, the UK and Switzerland, excluding Hungary. It is not available through Stripe to a US-based business. The registration country must be confirmed.

For an eligible Stripe account, the integration already uses Dashboard-managed payment methods, so enable/link PayPal there and test its capture, webhook fulfillment and refunds; do not add a duplicate payment submission path or advertise PayPal before it is enabled.

A US business needs a separate PayPal Business integration. That requires account setup and sandbox credentials, server-side create/capture/verification, provider-bound checkout reservation/idempotency, payment/refund records, verified webhooks and reconciliation before exposing a PayPal button. No fake or nonfunctional PayPal button is included. Country/account details are pending from the owner.

Sources: https://docs.stripe.com/payments/paypal ; https://support.stripe.com/questions/paypal-payment-method-availability ; https://www.fda.gov/consumers/consumer-updates/have-food-allergies-read-label .
