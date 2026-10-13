# Luigi’s MariaDB ordering system

The supplied pizza interface is connected to a Node.js API and MariaDB. The unrelated existing site in the parent directory is preserved. Customers order from a browser on Debian or another device; staff use `/admin` to view the latest 100 orders, change preparation status, and search customer records. Checkout is pickup with payment at the counter. No email is sent automatically.

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
GRANT SELECT, INSERT ON luigis.order_items TO 'luigis_app'@'127.0.0.1';
GRANT SELECT ON luigis.menu_prices TO 'luigis_app'@'127.0.0.1';
EXIT;
```

For a local trial, copy `.env.example` to `.env`, set the database and staff passwords, then run `npm start`. Open `http://localhost:3000` and `http://localhost:3000/admin`. The browser asks for the staff username/password. Node is bound to localhost by default. Access a remote trial through an SSH tunnel (`ssh -L 3000:127.0.0.1:3000 your-server`) and use localhost in your browser. Keep `.env` private and out of version control.

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

`customers` stores names, email, optional phone, and timestamps. Matching normalized email addresses reuse a customer record; this is a contact directory, not verified customer accounts. `orders` stores an immutable customer-contact snapshot, retry key, status, and total. `order_items` stores item descriptions, quantities, and original prices. Foreign keys link these records. Indexed email, customer history, and status/date columns support lookup and future reporting.

Customer and order inserts commit together or roll back together. Parameterized queries protect customer data. A browser-generated random retry key returns the original receipt if a submission is retried. Prices come from MariaDB and totals use integer cents. Prices in receipts remain unchanged when menu prices change. There are no public customer-list or order-history endpoints. Staff pages use text nodes to display customer input.

Update menu prices with an administrator database account, for example:

```sql
UPDATE luigis.menu_prices SET price_cents = 1800 WHERE category='pizza' AND name='Large';
```

Refresh the ordering page after price changes. All topping prices must remain equal because the supplied interface displays a single topping price. The backend uses the actual individual price for each topping. Menu names and drink choices are currently tied to the supplied pizza interface.

Statuses progress from received → preparing → ready → completed; received, preparing, and ready orders can be cancelled. Closed orders cannot be reopened. The staff queue refreshes manually. Pickup estimates are the supplied static 30–45 minutes; actual capacity, tax rules, business hours enforcement, delivery, online payment, notifications, customer login, and historical paper-record import require business-specific configuration before rollout. No card fields or card data storage are included.

## Verification and backups

Run `npm test` to verify pricing and validation. Before launch on Debian, submit an order, verify it in the staff queue and customer directory, restart the service and confirm persistence, replay the same request key and confirm only one order exists, and verify invalid submissions create no records. Confirm unauthenticated `/api/admin/customers` returns 401 and status transitions reject completed → preparing.

```sh
sudo mariadb-dump --single-transaction luigis > luigis-backup.sql
# Restore into a separate test instance first:
sudo mariadb luigis < luigis-backup.sql
```

Backups contain customer information: keep them encrypted, restrict access, schedule backups, and test restoration. Agree a retention period with the company and restrict staff access. Do not run the restore command against live data without a planned recovery procedure.

Schema and transaction references: [MariaDB CREATE TABLE](https://mariadb.com/docs/server/server-usage/tables/create-table), [MariaDB transactions](https://mariadb.com/docs/server/reference/sql-statements/transactions).
