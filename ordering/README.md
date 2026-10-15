# Luigi’s MariaDB ordering system

The supplied pizza interface is connected to a Node.js API and MariaDB. Customers can check out as guests; sign-in and account creation remain a teammate-owned integration. Staff use `/admin` for current and past orders, order edits, analytics, and customer search. Checkout uses Stripe-hosted online payment. No email is sent automatically.

## Debian installation

Use Node.js 22 or later, npm, MariaDB, and nginx. Check `node --version` first; an older Debian package may need a newer Node installation. Copy this directory to `/opt/luigis` on the Debian server.

```sh
sudo apt update
sudo apt install mariadb-server nginx nodejs npm
sudo systemctl enable --now mariadb
cd /opt/luigis
npm install --ignore-scripts
sudo mariadb < db/schema.sql
sudo mariadb
```

In the MariaDB console, create a restricted runtime account with a real unique password:

```sql
CREATE USER 'luigis_app'@'127.0.0.1' IDENTIFIED BY 'YOUR_LONG_RANDOM_PASSWORD';
GRANT SELECT, INSERT, UPDATE ON luigis.customers TO 'luigis_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON luigis.orders TO 'luigis_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON luigis.pending_checkouts TO 'luigis_app'@'127.0.0.1';
GRANT SELECT, INSERT, DELETE ON luigis.order_items TO 'luigis_app'@'127.0.0.1';
GRANT SELECT, INSERT ON luigis.order_events TO 'luigis_app'@'127.0.0.1';
GRANT SELECT ON luigis.menu_prices TO 'luigis_app'@'127.0.0.1';
EXIT;
```

For a local trial, copy `.env.example` to `.env`, set the database and staff passwords, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the public HTTPS `SITE_URL`, then run `npm start`. Configure a Stripe webhook endpoint at `https://your-domain/api/stripe/webhook` for `checkout.session.completed`. Open `http://localhost:3000` and `http://localhost:3000/admin`. The browser asks for the staff username/password. Node is bound to localhost by default. Access a remote trial through an SSH tunnel (`ssh -L 3000:127.0.0.1:3000 your-server`) and use localhost in your browser. Keep `.env` private and out of version control.

For an existing database, apply the current schema again to create the new `order_events` audit table (`CREATE TABLE IF NOT EXISTS` is used), then grant the app `SELECT, INSERT` on `luigis.order_events` and `DELETE` on `luigis.order_items` for staff item edits.

For a persistent service:

```sh
sudo useradd --system --home /opt/luigis --shell /usr/sbin/nologin luigis
sudo cp .env.example /etc/luigis.env
sudo chmod 600 /etc/luigis.env
sudoedit /etc/luigis.env
sudo cp deploy/luigis.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now luigis
sudo systemctl status luigis
```

Set real passwords in `/etc/luigis.env`; systemd reads that protected file. Ensure `/usr/bin/node` is version 22+ and the `luigis` account can read `/opt/luigis`. Add the proxy location in `deploy/nginx.conf` to your domain's HTTPS nginx server, configure a valid certificate, run `sudo nginx -t`, and reload nginx. Keep MariaDB and port 3000 inaccessible from the public network. Basic staff authentication requires HTTPS for remote access. For a public launch, add nginx request throttling for order submission and staff login, and replace the single shared staff account if individual staff auditing is needed.

## Data and operation

`customers` stores names, email, optional phone, and timestamps. Matching normalized email addresses reuse a customer record; this is a contact directory, not verified customer accounts. `orders` stores a customer-contact snapshot, retry key, status, and total. `order_items` stores item descriptions, quantities, and original prices. `order_events` records order creation, staff status changes, and staff item edits. Foreign keys link these records. Indexed email, customer history, and status/date columns support lookup and future reporting.

Customer and order inserts commit together or roll back together. Parameterized queries protect customer data. A browser-generated random retry key returns the original receipt if a submission is retried. Prices come from MariaDB and totals use integer cents. Prices in receipts remain unchanged when menu prices change. `GET /api/orders/mine` requires the verified identity resolver and returns only orders associated with its verified email; no public customer-list or order-history endpoints exist. Staff pages use text nodes to display customer input.

See [AUTH_INTEGRATION.md](./AUTH_INTEGRATION.md) for the browser and server handoff contract. Authentication is intentionally not implemented in this project yet; until the teammate-owned provider is connected, guest checkout works and account buttons explain the pending integration.

Update menu prices with an administrator database account, for example:

```sql
UPDATE luigis.menu_prices SET price_cents = 1800 WHERE category='pizza' AND name='Large';
```

Refresh the ordering page after price changes. All topping prices must remain equal because the supplied interface displays a single topping price. The backend uses the actual individual price for each topping. Menu names and drink choices are currently tied to the supplied pizza interface.

Statuses progress from received → preparing → ready → completed; received, preparing, and ready orders can be cancelled. Closed orders cannot be reopened. Staff can edit menu-valid items and quantities for active orders; totals are recalculated against database prices. The current/past split follows explicit order status, never age. Active orders older than 45 minutes are flagged for a staff check but are not automatically advanced. Stripe-hosted Checkout handles card entry; Luigi’s application does not receive or store card numbers. Orders are only created after Stripe confirms payment.

## Verification and backups

Run `npm test` to verify pricing and validation. Before launch on Debian, submit an order, verify it in the staff queue and customer directory, restart the service and confirm persistence, replay the same request key and confirm only one order exists, and verify invalid submissions create no records. Confirm unauthenticated `/api/admin/customers` returns 401 and status transitions reject completed → preparing.

```sh
sudo mariadb-dump --single-transaction luigis > luigis-backup.sql
# Restore into a separate test instance first:
sudo mariadb luigis < luigis-backup.sql
```

Backups contain customer information: keep them encrypted, restrict access, schedule backups, and test restoration. Agree a retention period with the company and restrict staff access. Do not run the restore command against live data without a planned recovery procedure.

Schema and transaction references: [MariaDB CREATE TABLE](https://mariadb.com/docs/server/server-usage/tables/create-table), [MariaDB transactions](https://mariadb.com/docs/server/reference/sql-statements/transactions).
