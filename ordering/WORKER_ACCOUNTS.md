# Worker accounts

Each employee has an individual account with the shared Worker role. Do not share passwords.

Administrators: menu and pricing, analytics, customer records, account invitations and role changes, all existing order management.
Workers: active kitchen queue at /staff, next preparation stage, pickup estimate, and marking ready orders as picked up. Management pages and APIs remain administrator-only.
Customers: existing checkout and their own account/order features.

## Create a worker

1. Apply the migration below and restart Node before inviting workers.
2. Sign in as an administrator and open /admin/accounts.
3. Invite the employee using their own name, email and phone. Choose Worker.
4. The employee accepts their email invitation and chooses their password.
5. After signing in, workers open /staff automatically. The homepage Orders button also opens their kitchen queue.

An administrator can change an existing account to Worker. Changing roles revokes its sessions, so the employee must sign in again. Keep at least one administrator enabled.

## Existing Debian installation

Back up the database and deployed source first. Upload the changed files preserving the project structure. From the deployed project root:

    sudo mariadb luigis < ordering/db/007_worker_roles.sql
    sudo systemctl restart luigis
    sudo systemctl status luigis --no-pager

The migration adds Worker to the accounts role enum and preserves existing customer/admin accounts. It requires the earlier account migrations to exist. For a new installation, apply schema and numbered migrations in order, including 007. Do not replace an existing database with a fresh schema.

No new .env settings are required. Keep the existing database, internal-service, SMTP, and payment configuration private. The existing Node-to-lifecycle proxy supplies employee identity to preparation/pickup audit events. Order creation receipts and ready-for-pickup notices use the existing email queue. Other progress and pickup estimates appear on the tracker without additional emails.

## Verification

From ordering: npm test. Tests cover invitation acceptance, login, session revocation, role escalation prevention, route permissions, queue actions and pickup estimates. Live database/payment/browser tests can be skipped unless their required environment is configured; passing offline tests does not establish a successful VM deployment.

After deployment, invite a worker and verify their access to /staff, then verify /admin/accounts and /admin/analytics are denied. Use a deliberate test order to verify progress notifications. Do not use an actual customer order for testing.
