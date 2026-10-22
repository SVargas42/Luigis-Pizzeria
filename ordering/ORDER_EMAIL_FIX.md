# Order email delivery

Pickup order confirmations/receipts and staff lifecycle updates now enter the existing `account_mail` outbox inside the same transaction as the order change. The Node worker uses the shared Gmail configuration and retries failed sends at five-minute intervals, up to ten attempts. No database migration is required after the accounts and Stripe migrations are installed. The `receipt` purpose also covers transactional progress messages so these do not expire like account reset links.

Notifications cover receipt, confirmation, preparation, cooking, ready for pickup, changed pickup estimate, and pickup completion. Stale/repeated status requests do not enqueue duplicates. Retrying the same successful pickup order returns its existing receipt without another email. Repeating an identical pickup estimate does not send another message. Stripe receipts continue to queue only after verified successful payment. Merely opening Checkout does not create a paid order or send its receipt.

No historical messages are backfilled. Gmail acceptance is not proof of inbox delivery, and SMTP can deliver duplicates after an ambiguous network failure. This is transactional order email, not SMS, browser push, or marketing mail. Existing legacy cancellation endpoints are not changed by this patch.

On Debian both services must use `/etc/luigis.env`. Restart `luigis-lifecycle` after installing `ordering/lifecycle/app.py` and the new `order_mail.py`. Keep `luigis` running: it owns the SMTP outbox worker. Both services' database account needs SELECT, INSERT and UPDATE on `account_mail` as already required by account email delivery. Do not publish this config file or print its contents.

Check queue health without revealing recipient addresses or messages:

```bash
sudo mariadb luigis -e "SELECT purpose, COUNT(*) AS total, SUM(sent_at IS NOT NULL) AS sent, SUM(sent_at IS NULL AND attempts<10) AS pending, SUM(sent_at IS NULL AND attempts>=10) AS exhausted FROM account_mail GROUP BY purpose;"
```

Verify with a new pay-at-pickup order using an inbox you control. Check the receipt, advance each staff stage once, update the estimate and complete pickup. Check receipt/progress mail and tracker links. Test Stripe separately with a completed sandbox payment and successful webhook; verify exactly one paid order and its receipt. Use a deliverable address, not an example address. Exhausted messages require operator investigation; do not bulk reset or resend old messages blindly.

Automated tests cover pickup retry deduplication, all lifecycle notifications, identical estimates, unauthorized/stale transitions, rollback of both orders and notifications on queue failure, and existing SMTP retries. Test fixtures use isolated SQLite and mocked SMTP rather than contacting customers.
