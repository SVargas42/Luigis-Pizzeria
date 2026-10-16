# Order lifecycle deployment

The existing Node server remains the front door for the homepage, identity integration,
staff pages and analytics. It proxies only lifecycle routes to FastAPI on loopback port
8000. No customer authentication or analytics implementation is added. Both services
use the existing MySQL/MariaDB tables. Never expose ports 3000, 8000 or 3306 publicly.

## First: read-only Debian diagnostics

Run these over SSH before installing packages or applying DDL. No VM connection was
provided, so these checks must be run on the target VM. Each command is read-only.

| Command | Purpose and success / failure | sudo |
| --- | --- | --- |
| `pwd; git status --short` | Confirm checkout and local edits; correct repository path and understood edits mean proceed; wrong path means stop. | No |
| `python3 --version; command -v python3; printf '%s\n' "${VIRTUAL_ENV:-No active venv}"` | Python version, executable, active venv; Python 3.10+ is required; missing/older Python fails. | No |
| `python3 -m pip show fastapi uvicorn PyMySQL httpx pytest` | Installed dependency versions; package metadata means installed, “not found” means install in the intended venv. | No |
| `systemctl is-active mysql mariadb` | At least the installed database service should report active; inactive/unknown means investigate that service. | No |
| `mysql --host=127.0.0.1 --user=luigis_app --password --database=luigis --execute='SELECT VERSION(); SELECT 1; SHOW TABLES; SHOW CREATE TABLE orders; SHOW CREATE TABLE order_events; SHOW CREATE TABLE order_items; SHOW CREATE TABLE menu_prices;'` | Prompts for password without putting it in shell history; version, 1 and table DDL indicate connectivity; access denied/missing tables fail. Record engine/version before migration. | No |
| `pgrep -af 'uvicorn|fastapi|node.*server'` | Shows current application processes; no matches means none running. | No |
| `ss -ltnp` | Shows listeners; confirm intended loopback bindings and no conflicting port 8000. Process names may be hidden without elevated privileges. | No |

## Install only missing packages

| Command | Purpose and success / failure | sudo |
| --- | --- | --- |
| `sudo apt-get update` | Refresh Debian package metadata; successful exit means ready; repository/network errors fail. | Yes |
| `sudo apt-get install python3 python3-venv default-mysql-client` | Install Python, venv support and DB diagnostic client; exit 0 succeeds; apt errors fail. Use the existing database server, do not install a second one. | Yes |
| `python3 -m venv .venv-lifecycle` | Create isolated environment in repository; exit 0 succeeds; permission/ensurepip errors fail. | No |
| `.venv-lifecycle/bin/python -m pip install -r ordering/lifecycle/requirements.txt` | Install lifecycle runtime requirements; exit 0 succeeds; resolver/build/network errors fail. | No |
| `.venv-lifecycle/bin/python -m pip install httpx pytest` | Install test-only dependencies; exit 0 succeeds; dependency errors fail. | No |

## Migration and configuration

Back up the database first. `ordering/db/002_lifecycle.sql` is a **one-time** additive
migration for the existing schema, compatible with MySQL 8 and MariaDB. It preserves
legacy status and Stripe fields and adds separate five-stage tracking fields.
DDL auto-commits: test against a restored database first; do not blindly retry a partially
applied migration. The application account needs existing SELECT/INSERT/UPDATE grants
on customers/orders, SELECT/INSERT on order_items/order_events and SELECT on menu_prices.

| Command | Purpose and success / failure | sudo |
| --- | --- | --- |
| `mysqldump --host=127.0.0.1 --user=BACKUP_USER --password --single-transaction luigis > luigis-before-lifecycle.sql` | Create backup using an appropriately privileged DB account; exit 0 and nonempty SQL file succeed; dump errors fail. Contains personal data; store privately. | No |
| `mysql --host=127.0.0.1 --user=MIGRATION_USER --password luigis < ordering/db/002_lifecycle.sql` | Apply migration with DB DDL privileges; exit 0 succeeds; any SQL error requires inspecting schema before retrying. | No (DB privileges required) |
| `set -a; . /etc/luigis.env; set +a` | Export the trusted existing service environment into this shell; exit 0 succeeds; missing/unreadable file fails. File must be shell-compatible and readable by the operator. | No |
| `.venv-lifecycle/bin/python -m uvicorn ordering.lifecycle.app:app --host 127.0.0.1 --port 8000` | Start FastAPI from repository root; startup complete succeeds; import/config/port errors fail. Run via your existing service manager for persistence. | No |
| `.venv-lifecycle/bin/python -m pytest ordering/lifecycle/tests -q` | Run automated lifecycle tests; passing summary succeeds, failures must be fixed. | No |
| `npm --prefix ordering test` | Run existing adjacent Node/frontend tests; passing summary succeeds, failures require investigation. | No |

Set `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `ADMIN_USER`,
`ADMIN_PASSWORD` in both services. Set `SITE_URL` to the public HTTPS origin, and
`LIFECYCLE_URL=http://127.0.0.1:8000` on Node. Set `TAX_BASIS_POINTS` explicitly
to the business-approved rate (0 means zero tax; 825 means 8.25%). No location-specific
rate is assumed. Optional mail settings: `SMTP_HOST`, `SMTP_PORT` (default 587),
`SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`; SMTP uses STARTTLS. Without SMTP the
complete text receipt is logged locally. Restrict access to logs, which contain
contact details and bearer tracker links. BackgroundTasks is best-effort in-process
dispatch, not a durable mail queue; failed SMTP dispatch falls back to logging.

Online checkout is explicitly a mock: no card details are collected or charged.
Pickup orders are unpaid. “Verified” kitchen orders means server-validated menu,
contact information and committed transaction, not verified email or settled payment.
Existing Stripe routes remain available to existing callers.

Public tracker URLs contain a 256-bit bearer token and return only stage, pickup
estimate and order number. Receipt/contact information is returned only at creation
(or replay with the same unguessable UUID retry key). Staff APIs require existing
Basic credentials over HTTPS. Advancements include expected current status and
lock the row to reject stale concurrent clicks. Ready orders stay active until archived.
Legacy orders without tokens keep their existing dashboard behavior.

API: POST `/api/orders`; GET `/api/orders/{token}/track`; GET
`/api/employee/orders/active`; PATCH `/api/employee/orders/{id}/status` with
`{status,expectedStatus}`; PATCH `/api/employee/orders/{id}/estimate` with
`{estimatedPickupTime: "2026-10-16T22:30:00Z"}`; POST
`/api/employee/orders/{id}/complete` with `{expectedStatus:"order_ready"}`.

Implementation references: [FastAPI BackgroundTasks](https://fastapi.tiangolo.com/tutorial/background-tasks/),
[FastAPI testing](https://fastapi.tiangolo.com/tutorial/testing/),
[MySQL ALTER TABLE](https://dev.mysql.com/doc/refman/8.0/en/alter-table.html).
