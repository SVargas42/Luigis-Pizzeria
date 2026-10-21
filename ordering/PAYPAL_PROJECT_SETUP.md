# PayPal for the Luigi school project

The owner confirmed this is a US-based school/demo project on 21 October 2026. Keep actual money disabled. The customer-facing restaurant copy can remain professional; the provider's sandbox checkout and the demonstration instructions must make clear that payments are tests. Do not recruit real customers or claim a real restaurant is accepting these payments.

PayPal is not available through Stripe for a US merchant account. A redirect to PayPal is supported by PayPal Checkout, but a simple payment link cannot safely mark a Luigi order paid. The backend must create an order priced from the database, redirect to its provider-returned approval URL, capture and verify the payment on the server, then fulfill one order and queue its receipt. A browser return URL alone never proves payment.

For this project, a live PayPal Business account is unnecessary. Use a PayPal developer login with a sandbox Business (seller) account and a sandbox Personal (buyer) account. PayPal creates default sandbox accounts during developer setup. No real funds move. Keep credentials out of chat, public JavaScript and Git.

Owner setup:

1. Sign in or register at https://developer.paypal.com/dashboard/ . The owner must handle login and account creation.
2. Open Testing Tools / Sandbox Accounts. Confirm a US Business seller and Personal buyer account exist. Use the sandbox buyer's generated credentials only on sandbox.paypal.com, not a real PayPal buyer's login.
3. In Apps & Credentials select Sandbox, create a Merchant app named Luigi Website, and select the sandbox Business seller. Keep its Client ID and Secret available privately for the later hidden SSH setup.
4. Tell the developer when the sandbox app exists. A PayPal button, capture endpoint, verified webhook handling, migration and reconciliation must be implemented/tested before a payment option is exposed. Do not configure a guessed webhook URL or paste credentials into chat.

Implementation must preserve cross-provider checkout reservations so Stripe, PayPal and pickup cannot create separate paid orders for one request key. It must verify merchant, amount, USD currency, completed capture and order ownership; persist unique order/capture/event IDs; process retries/refunds safely and use the existing order/email queues. PayPal remains unavailable until that work and sandbox end-to-end tests pass.

The new footer includes the owner-supplied contact details and a written project refund policy. It does not add automatic refunds or claim a verified recipe/allergen matrix. Refunds remain an authorized provider operation. A real launch would require operator and legal review of policies and payment onboarding.

Sources: https://developer.paypal.com/sandbox-testing/accounts ; https://developer.paypal.com/api/rest/ ; https://support.stripe.com/questions/paypal-payment-method-availability .
