# Deploy Luigi's Pizza to Debian using GCP browser SSH

Website: https://luigispizza.duckdns.org . This guide assumes MariaDB, Node, Python and Nginx all run on the same Debian VM, with Nginx directly facing clients. Run Linux commands inside GCP browser SSH as your normal non-root SSH user. Existing database data and private `.env` settings must be preserved.

## 1. Prepare the information only you can supply

You need the existing MariaDB password for `luigis_app`@`127.0.0.1`, a separate strong internal-service password, a verified Resend sender and API key, and SMTP provider credentials for pickup receipts. Do not send these in chat or put them in public files. Generate new passwords with `openssl rand -hex 32` if needed; changing DB_PASSWORD alone does not change MariaDB's password.

The DuckDNS hostname can host your website. It does not automatically provide a mailbox or a verified sending domain. Resend requires control of the sender domain's required DNS records. If you cannot create its required verification/DKIM records under DuckDNS, use a separate domain you control for email; the website can remain on DuckDNS. Account registration/recovery cannot be released without email delivery. SMTP must support STARTTLS on the configured port (typically 587); this implementation does not use implicit-TLS port 465.

Stripe is optional: leave STRIPE_ENABLED=0 until real sandbox setup and payment/refund checks pass. Complete business tax configuration before accepting orders; 0 is not a recommendation for the actual business.

## 2. Upload the new ZIP

Use `luigis-debian-deployment.zip` from this response. It contains index.html, ordering/ runtime code, migrations, tests, deployment helpers, and this guide. It excludes `.env`, node_modules, Python environments/caches and historical deployment scripts. Do not upload the entire FirstProject workspace, old release folders, backups, or database dumps.

In Google Cloud Console open Compute Engine > VM instances > SSH beside luigispizza. In browser SSH select Upload file (under the window's file-transfer/settings menu) and choose the ZIP. Uploaded files normally arrive in your Linux home directory. Check:

```bash
pwd
ls -lh "$HOME/luigis-debian-deployment.zip"
```

## 3. Install system packages (safe to repeat)

```bash
sudo apt update
sudo apt install -y mariadb-server mariadb-client python3 python3-venv curl git unzip openssl nginx certbot python3-certbot-nginx cron
sudo systemctl enable --now mariadb cron
```

If `node --version` is already 22 or newer, you can keep it. Otherwise:

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh -o /tmp/luigis-install-nvm.sh
bash /tmp/luigis-install-nvm.sh
source "$HOME/.nvm/nvm.sh"
nvm install 24
nvm alias default 24
node --version
npm --version
```

## 4. Back up and install the uploaded code

Check whether this is your existing deployment path:

```bash
ls -ld "$HOME/Luigis-Pizzeria"
```

If the existing website is installed elsewhere, use its actual location consistently instead of creating a second live copy. For an existing deployment stop both app services before copying; if a unit does not exist yet, skip stopping that unit:

```bash
sudo systemctl stop luigis-web luigis-lifecycle
```

If Luigis-Pizzeria already exists, back it up (includes its private env, so restrict the backup):

```bash
umask 077
tar --exclude=node_modules --exclude=.venv --exclude=__pycache__ -czf "$HOME/luigis-code-before-$(date +%Y%m%d-%H%M%S).tar.gz" -C "$HOME" Luigis-Pizzeria
```

If the luigis database already exists, back it up before SQL changes:

```bash
umask 077
sudo mariadb-dump --single-transaction luigis > "$HOME/luigis-db-before-$(date +%Y%m%d-%H%M%S).sql"
```

Extract and copy the code. These commands overwrite matching code files but do not delete files; the ZIP has no `.env`:

```bash
strUploadDir="$(mktemp -d "$HOME/luigis-upload.XXXXXX")"
unzip "$HOME/luigis-debian-deployment.zip" -d "$strUploadDir"
mkdir -p "$HOME/Luigis-Pizzeria"
cp -a "$strUploadDir/." "$HOME/Luigis-Pizzeria/"
cd "$HOME/Luigis-Pizzeria"
ls ordering/db
```

## 5. Inspect your existing database before choosing migrations

```bash
sudo mariadb < ordering/deploy/inspect-database.sql
```

This is read-only and displays tables, relevant columns/indexes and the app user's host. Presence alone is not a complete schema validation.

- No luigis database: use the fresh-database sequence below.
- Existing base tables but NONE of the six lifecycle columns: apply 002 once, then the missing later migrations.
- Existing lifecycle: the six columns tracking_token, tracking_status, payment_status, subtotal_cents, tax_cents, estimated_pickup_time and lifecycle_queue index must exist, and payment_method must include in_store. Do not rerun 002.
- Existing accounts: accounts, account_sessions, account_actions, account_order_claims, account_mail, account_throttles, account_audit must all exist. If absent, apply 003.
- Existing Stripe schema: checkout_reservations, stripe_payments, stripe_events, stripe_refunds, orders.refunded_cents and account_mail.purpose must exist, and orders.payment_status must include paid/refunded. If absent, apply 004 after 003.

If you see a mixture of missing and present columns/tables, stop and inspect the output instead of guessing or dropping data. Do not rerun schema.sql over an existing lifecycle database: its old enum ALTER can narrow existing payment methods.

FRESH DATABASE ONLY, each command must succeed before the next:

```bash
sudo mariadb < ordering/db/schema.sql
sudo mariadb luigis < ordering/db/002_lifecycle.sql
sudo mariadb luigis < ordering/db/003_accounts.sql
sudo mariadb luigis < ordering/db/004_stripe.sql
```

EXISTING DATABASE: run only the missing files from that list in order. For example, if lifecycle is complete but accounts/Stripe are absent:

```bash
sudo mariadb luigis < ordering/db/003_accounts.sql
sudo mariadb luigis < ordering/db/004_stripe.sql
```

## 6. Database user and grants

If `luigis_app`@`127.0.0.1` already exists and its password works, keep it. If absent, open `sudo mariadb` and create it with your actual generated password:

```sql
CREATE USER 'luigis_app'@'127.0.0.1' IDENTIFIED BY 'REPLACE_WITH_YOUR_ACTUAL_DATABASE_PASSWORD';
EXIT;
```

If deliberately rotating an existing user's password, use ALTER USER instead, and update the VM `.env` to match before starting services. The hostname `localhost` in a MariaDB warning does not prove which grant entry matched; inspect the user entries first.

After all migrations, grant the table permissions the application needs:

```bash
sudo mariadb < ordering/deploy/runtime-grants.sql
mariadb -h 127.0.0.1 -u luigis_app -p luigis -e "SELECT 1 AS connection_ok;"
```

The password is prompted; it must match DB_PASSWORD below.

## 7. Create/merge and edit the VM .env

```bash
cd "$HOME/Luigis-Pizzeria/ordering"
node deploy/merge-env.js
nano .env
```

The merge command only appends missing setting names; it never replaces your existing passwords or other values. Fill the following configuration with your own credentials. Do not leave REPLACE values or sender examples in the real file:

```dotenv
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=luigis_app
DB_PASSWORD="REPLACE_WITH_ACTUAL_DATABASE_PASSWORD"
DB_NAME=luigis
HOST=127.0.0.1
PORT=3000
SITE_URL=https://luigispizza.duckdns.org
ADMIN_USER=lifecycle_service
ADMIN_PASSWORD="REPLACE_WITH_DIFFERENT_INTERNAL_SERVICE_PASSWORD"
LIFECYCLE_URL=http://127.0.0.1:8000
RESEND_API_KEY="REPLACE_WITH_ACTUAL_RESEND_API_KEY"
ACCOUNT_MAIL_FROM="Luigi Accounts <accounts@YOUR_VERIFIED_SENDING_DOMAIN>"
TRUST_PROXY_LOOPBACK=1
STRIPE_ENABLED=0
STRIPE_MODE=test
STRIPE_SECRET_KEY=""
STRIPE_WEBHOOK_SECRET=""
TAX_BASIS_POINTS=0
SMTP_HOST="REPLACE_WITH_SMTP_PROVIDER_HOST"
SMTP_PORT=587
SMTP_FROM="REPLACE_WITH_VERIFIED_SENDER_ADDRESS"
SMTP_USER="REPLACE_WITH_SMTP_USERNAME"
SMTP_PASSWORD="REPLACE_WITH_SMTP_PASSWORD"
```

Confirm TAX_BASIS_POINTS with the business. ADMIN_USER and ADMIN_PASSWORD are private credentials between Node and Python, not a website admin login. Both services read the same file. Wrap secrets in double quotes, especially if they contain # or spaces; generated hex secrets avoid quoting issues. Save nano with Ctrl+O, Enter, Ctrl+X.

```bash
chmod 600 .env
node --env-file=.env deploy/check-env.js
```

Fix all reported configuration errors before public release. This validator checks structure and missing values, not actual credentials/DNS/domain verification or SMTP connectivity. If mail isn't ready, you can run isolated local tests with `--local`, but registration/recovery and receipt delivery are not ready for customers. Keep Node private; do not weaken production SITE_URL to public HTTP.

## 8. Install and test dependencies

```bash
npm ci --ignore-scripts
npm test
RUN_DB_TEST=1 node --env-file=.env --test test/database.live.test.js test/accounts.live.test.js test/payments.live.test.js
cd "$HOME/Luigis-Pizzeria"
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r ordering/lifecycle/requirements-test.txt
.venv/bin/python -m pytest ordering/lifecycle/tests -q
```

Do not proceed past failed tests. The three live Node tests must run, not skip. Their records roll back. The Stripe database test uses an offline payment adapter; it does not confirm real Stripe payments.

## 9. Bootstrap your first website admin

```bash
cd "$HOME/Luigis-Pizzeria/ordering"
node --env-file=.env scripts/create-admin.js
```

Enter your real name, email, phone and a hidden 12–128 character website password. If an active admin already exists, sign in with that account instead; use its invitations to create more staff. No admin account is created by editing ADMIN_PASSWORD.

## 10. Install the two persistent services

These commands assume the app is at the home path used throughout this guide. The renderer rejects unusual paths and root service users rather than generating unsafe units:

```bash
cd "$HOME/Luigis-Pizzeria/ordering"
strServiceDir="$(mktemp -d "$HOME/luigis-services.XXXXXX")"
node deploy/render-services.js "$HOME/Luigis-Pizzeria" "$(command -v node)" "$(id -un)" "$strServiceDir"
cat "$strServiceDir/luigis-web.service" "$strServiceDir/luigis-lifecycle.service"
sudo install -m 644 "$strServiceDir/luigis-web.service" /etc/systemd/system/luigis-web.service
sudo install -m 644 "$strServiceDir/luigis-lifecycle.service" /etc/systemd/system/luigis-lifecycle.service
sudo systemctl daemon-reload
sudo systemctl enable --now luigis-lifecycle luigis-web
sudo systemctl restart luigis-lifecycle luigis-web
sudo systemctl status luigis-lifecycle luigis-web --no-pager --full
curl -i http://127.0.0.1:3000/api/menu
curl -i http://127.0.0.1:3000/api/session
```

Because SITE_URL is public HTTPS, use the public site for browser writes. A curl GET on loopback is just a backend availability check. If a service fails, inspect `sudo journalctl -u luigis-web -u luigis-lifecycle -n 80 --no-pager --full`. Never post logs containing tokens or credentials. Regenerate the Node unit if an nvm upgrade changes its absolute Node executable path.

## 11. DNS, firewall, Nginx and HTTPS

In DuckDNS set luigispizza's address to this VM's public IP; use a reserved static GCP IP or keep DuckDNS updated when the IP changes. Do not add an IPv6 record unless IPv6 reaches the VM correctly. Confirm from Debian:

```bash
getent ahostsv4 luigispizza.duckdns.org
```

In GCP allow inbound TCP 80 and 443 to this VM using the applicable VPC firewall rules/tags. Allow those ports in an existing VM firewall too; preserve SSH access. Do not expose ports 3000, 8000 or 3306 publicly.

Generate and inspect the Nginx config:

```bash
cd "$HOME/Luigis-Pizzeria/ordering"
node deploy/render-nginx.js luigispizza.duckdns.org > /tmp/luigis-nginx.conf
cat /tmp/luigis-nginx.conf
```

If this domain ALREADY has an HTTPS Nginx server block, preserve its certificates/redirects and merge the location block from the template instead of overwriting it. The commands below are for first-time Nginx setup of this domain. Never blindly replace Certbot's HTTPS configuration with the HTTP bootstrap on later uploads.

```bash
sudo install -m 644 /tmp/luigis-nginx.conf /etc/nginx/sites-available/luigis
sudo ln -s /etc/nginx/sites-available/luigis /etc/nginx/sites-enabled/luigis
sudo nginx -t
```

If the symlink already exists, skip that creation command. Stop if nginx -t fails. Do not remove other sites. Then:

```bash
sudo systemctl enable --now nginx
sudo systemctl reload nginx
sudo certbot --nginx -d luigispizza.duckdns.org --redirect
sudo certbot renew --dry-run
curl -I http://luigispizza.duckdns.org
curl -i https://luigispizza.duckdns.org/api/session
curl -i https://luigispizza.duckdns.org/api/admin/orders
```

Expect HTTP to redirect to HTTPS, a guest session response, and 403 for the unauthenticated admin API. Certbot issuance requires DNS and public port 80 to work. Check certificate renewal timer with `systemctl list-timers --all` and the dry-run above.

## 12. Browser verification and remaining release work

Open https://luigispizza.duckdns.org . Register with a real email, receive/redeem verification, sign in/out, reset the password and confirm old sessions are revoked. Place a pickup order and confirm receipt email, tracker, customer history, and admin queue/analytics. Test another customer cannot access that history, and customers/guests cannot use admin APIs. Test admin invitations, keyboard navigation and error messages. Restart both services and confirm the order persists.

Pickup SMTP currently logs a safe delivery failure but does not persist retries. The committed order remains available in the website/tracker. Verify real SMTP delivery and monitor failures; a durable pickup-receipt retry queue is separate work if guaranteed email recovery is required. Card and account mail use the durable Node outbox.

Before live customers: confirm menu/prices, tax, opening/pickup policies, privacy/retention policies and company-approved backup retention. Schedule account maintenance daily and, when Stripe is configured, reconciliation every five minutes. Use `command -v node` for the exact absolute executable in `crontab -e`:

```cron
15 3 * * * cd /home/YOUR_LINUX_USER/Luigis-Pizzeria/ordering && /ABSOLUTE/PATH/TO/node --env-file=.env scripts/account-maintenance.js
*/5 * * * * cd /home/YOUR_LINUX_USER/Luigis-Pizzeria/ordering && /ABSOLUTE/PATH/TO/node --env-file=.env scripts/reconcile-stripe.js
```

Add the Stripe job only after its keys are configured. Back up MariaDB regularly, keep encrypted copies outside the VM and verify restoration into a separate test database. Do not assume a same-VM backup protects against losing that VM.

## 13. Optional Stripe go-live

Keep STRIPE_ENABLED=0 initially. Follow ordering/STRIPE_SETUP.md for real sandbox keys, signed webhook events and reconciliation. Use webhook URL https://luigispizza.duckdns.org/api/stripe/webhook . Sandbox success/decline/3DS/retry/webhook/refund tests must pass before switching to matching live keys and STRIPE_MODE=live. No publishable key is needed by this hosted Checkout implementation. Configure tax consistently in the shared env. Pausing new card checkout must not remove keys needed to reconcile existing payments.

## Later updates

Upload new code without `.env`, dependencies or databases. Back up before changes; preserve the VM env and existing HTTPS configuration; install dependencies when the lockfile changes; apply only new migrations; rerun tests; restart the affected backend services. Do not reinstall SQL tables after ordinary HTML or JavaScript edits. Review/remove obsolete code separately when a future update retires files, because copying does not remove them.

References: Google Cloud browser SSH/file transfer https://docs.cloud.google.com/compute/docs/instances/transfer-files ; nvm https://github.com/nvm-sh/nvm ; Nginx https://nginx.org/en/docs/http/ngx_http_proxy_module.html ; Resend domains https://resend.com/docs/dashboard/domains/introduction ; Certbot https://certbot.eff.org/instructions .
