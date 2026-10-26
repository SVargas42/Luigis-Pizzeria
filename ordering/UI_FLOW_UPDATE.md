# Approved ordering UI changes

- Home action: Start your Order.
- Pizza action: Add to Order opens a separate pizza selection.
- Each pizza selection starts at quantity 1. Its quantity applies to the selected size and toppings; the summary includes the combined price.
- Online orders accept up to 30 physical pizzas total across all selections. Larger orders should call 931-372-3122 to arrange pickup. The UI, Node validation, Stripe checkout and Python lifecycle validation enforce the same limit. Side/drink limits remain unchanged.
- Admin and worker pickup fields suggest current local time plus 15 minutes, rounded up to a whole minute, when an estimate is missing, invalid or in the past. Saved future estimates are preserved. The suggested value is not saved automatically and is not a customer pickup promise.

No .env changes or database migrations are required.

## Deployment

These changes are saved locally first. Do not upload preview-server.mjs, sample data, ui-flow-update.zip or any preview/test dependency folder. Production file changes are index.html, ordering/public/admin.html, ordering/public/staff.js, ordering/validation.js, ordering/payments.js and ordering/lifecycle/app.py. Updated automated tests are included in ordering/test and ordering/lifecycle/tests/test_lifecycle.py.

Deploy the UI and backend limit changes together, retaining the VM's existing credentials and unrelated fixes. A UI-only deployment would continue to hit the old 20-pizza backend limit. Back up the deployed files before updating, run checks and restart affected application services during the deployment step.
