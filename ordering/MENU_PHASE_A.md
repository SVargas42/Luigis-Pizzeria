# Menu editing: Phase A

Production schema/grants applied with explicit approval on October 20, 2026;
application query changes remain local and are not deployed. Migration 005 adds description and is_active to
menu_prices, retaining the existing category/name primary key. Existing and new
rows default to active. Inactive names remain reserved within their category.

Public menu, pickup pricing, Stripe quote creation and legacy order-editor pricing
read only active choices. Pickup also validates drink names against the active
catalogue and includes their price adjustment. Old receipts and already-created
Stripe quotes retain their stored descriptions and prices.

menu_queries.py contains parameterized insert/update/soft-delete queries for
Phase B. No new API routes or delete UI are implemented in Phase A. Phase B must
authorize requests through Node's verified admin session before forwarding to
FastAPI. Phase C will require Yes followed by the exact text DELETE plus a space
and the current item name. Authenticated live verification still requires a
provisioned administrator; the last audited production accounts table was empty.

## Approved production commands (completed)

The protected backup completed at
`/var/backups/luigis/menu-phase-a/menu_prices.sql`. MariaDB reported migration
success; SHOW CREATE TABLE confirms both columns and the flag constraint. All
18 items remain active with empty descriptions. The runtime account has SELECT,
INSERT and UPDATE on menu_prices; all four services remained active. No live
application files were replaced and no services were restarted.

First inspect SHOW COLUMNS FROM menu_prices and stop if description or is_active
already exists. Apply only to the audited schema. Take this protected table
backup; noclobber prevents overwriting an earlier backup:

```sh
sudo install -d -m 700 /var/backups/luigis/menu-phase-a
sudo sh -c 'umask 077; set -C; mariadb-dump --single-transaction luigis menu_prices > /var/backups/luigis/menu-phase-a/menu_prices.sql'
sudo test -s /var/backups/luigis/menu-phase-a/menu_prices.sql
```

Only after all three succeed, apply the exact migration and required table grant:

```sh
sudo mariadb luigis <<'SQL'
ALTER TABLE menu_prices
    ADD COLUMN description VARCHAR(1000) NOT NULL DEFAULT '';
ALTER TABLE menu_prices
    ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1
        CHECK (is_active IN (0, 1));
GRANT SELECT,INSERT,UPDATE ON luigis.menu_prices TO 'luigis_app'@'127.0.0.1';
SQL
```

MariaDB DDL auto-commits. If any statement fails, stop, inspect the actual schema,
and do not blindly rerun or restore. Do not reapply historical schema.sql: its
positional seed inserts predate these columns and other migrations.

Read-only verification after migration:

```sql
SHOW CREATE TABLE luigis.menu_prices;
SELECT COUNT(*) AS total_items,
       SUM(is_active = 1) AS active_items,
       SUM(description = '') AS empty_descriptions
FROM luigis.menu_prices;
```

The schema addition is compatible with the currently running application. No
restart or live application-file replacement is included in these commands.
Deploy the prepared query changes with later approved backend changes, after
the migration. Live file replacements require separate backups and approval.

## Local verification

- Node: 80 passed; 3 live database tests skipped.
- Python: 17 passed, including migration defaults/constraint, CRUD queries,
  inactive choices across all five menu categories, unchanged receipts and retry.
- Stripe regression tests reject inactive choices for new checkouts and fulfill
  an existing quote after a menu item becomes inactive.
- The migration/SQL behavior tests use SQLite, not MariaDB. Production DDL,
  defaults on existing rows and runtime grants were verified with read-only
  queries after migration; no live menu CRUD tests were run. Existing Python
  deprecation warnings remain.
