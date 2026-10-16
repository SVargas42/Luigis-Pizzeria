# Connect the VS Code page to MariaDB on Debian

The repository's root `index.html` is served by `ordering/server.js`. Run the page through this server rather than VS Code Live Server or a file URL: the same server handles `/api/menu` and `/api/orders`.

Copy the entire Luigis-Pizzeria repository to Debian. From its root directory:

```bash
sudo apt update
sudo apt install mariadb-server nodejs npm
sudo systemctl enable --now mariadb
sudo mariadb < ordering/db/schema.sql
sudo mariadb
```

At the MariaDB prompt, create the account (choose a real password):

```sql
CREATE USER 'luigis_app'@'127.0.0.1' IDENTIFIED BY 'YOUR_LONG_RANDOM_PASSWORD';
GRANT SELECT, INSERT, UPDATE ON luigis.customers TO 'luigis_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE ON luigis.orders TO 'luigis_app'@'127.0.0.1';
GRANT SELECT, INSERT ON luigis.order_items TO 'luigis_app'@'127.0.0.1';
GRANT SELECT ON luigis.menu_prices TO 'luigis_app'@'127.0.0.1';
USE luigis;
SHOW TABLES;
EXIT;
```

Then, in the Linux shell:

```bash
cd ordering
node --version  # Requires 22 or later
npm install --ignore-scripts
cp .env.example .env
chmod 600 .env
nano .env       # Set database password and staff credentials
npm test
npm start
```

Open `http://localhost:3000` to order and `/admin` for the staff queue. The backend saves the page's first name, last name, email, optional phone, pizzas with sizes and toppings, sides with quantities, and drinks with sizes and quantities. It calculates prices from MariaDB and returns the real order number to the confirmation page. Stripe Elements presents the card number, expiration, and security-code fields on the payment page; card details go directly to Stripe and are not stored by this application.

After placing an order, verify it in the Linux terminal:

```bash
sudo mariadb luigis
```

```sql
SELECT id, first_name, last_name, email, phone FROM customers;
SELECT id, customer_id, status, total_cents, created_at FROM orders;
SELECT order_id, description, quantity, unit_price_cents FROM order_items;
EXIT;
```

See README.md for production HTTPS and backup guidance. If using the systemd template with this repository layout, install the repository at `/opt/luigis` and change `WorkingDirectory` to `/opt/luigis/ordering` and `ExecStart` to `/usr/bin/node /opt/luigis/ordering/server.js`.
