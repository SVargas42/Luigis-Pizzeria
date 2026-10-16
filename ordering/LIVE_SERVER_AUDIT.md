# Live server audit — October 15, 2026 (America/Los_Angeles)

**Update:** deployment has now completed successfully. The findings and blocked
attempt below are historical; see [DEPLOYMENT_RESULT.md](./DEPLOYMENT_RESULT.md)
for current state, test results and recovery locations.

Inspected the existing Google Cloud SSH-in-browser session for VM `luigispizza`.
Only read-only server diagnostics, HTTP GET/HEAD requests and the existing
non-database-writing automated tests were run. No application files, packages,
service configurations or database records were changed. Normal shell history,
access logs and sudo audit logs may record these diagnostics.

## Verified environment

| Check | Observed result |
| --- | --- |
| OS | Debian GNU/Linux 13 (trixie) |
| Python | 3.13.5 |
| Node | 22.23.3 |
| Database | MariaDB 11.8.6 from Debian |
| nginx/database services | Active |
| Node application listener | `127.0.0.1:3000` |
| Database listener | `127.0.0.1:3306` |
| FastAPI listener | No listener on port 8000 |
| Application directory | `/opt/luigis/ordering` |
| Service | `luigis.service`, working directory `/opt/luigis/ordering` |
| Service definition | `/etc/systemd/system/luigis.service` |
| Environment file | `/etc/luigis.env`, mode 600, owner/group root |
| Public origin | `https://luigispizza.duckdns.org` |
| nginx route | `/` proxies to `http://127.0.0.1:3000` |

The server has the older Node/Stripe implementation. Its source tree has no
`lifecycle` directory or `LIFECYCLE.md`. The order table has the original legacy
statuses and payment methods, without any of the new lifecycle columns.
All six existing tables are present, and `menu_prices` contains 14 rows.

The system Python has no importable `fastapi`, `uvicorn` or `pymysql` modules.
It has no pip module; Debian reports `python3-venv` is not installed and no
`python3-pip` package is installed. No active virtual environment was reported
in the inspected shell. An unrelated virtual environment elsewhere on the
machine was not exhaustively ruled out.

Only variable names were extracted from the protected environment file. The
listed settings are HOST, PORT, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME,
ADMIN_USER and ADMIN_PASSWORD. No credential values were printed. Stripe,
SITE_URL, LIFECYCLE_URL, tax and SMTP settings were absent from that listing.

## Test evidence

| Test | Result |
| --- | --- |
| Deployed Node suite, `RUN_DB_TEST=0 node --test --test-reporter=spec` | 30 passed, 0 failed, 1 skipped |
| `node --check server.js` | No syntax errors |
| `sudo -n nginx -t` | Configuration syntax and validation successful |
| `sudo -n mariadb` read-only version/schema/menu queries | Successful |
| HTTPS certificate verification using curl | Successful, no certificate bypass |
| Public GET `/` | 200 |
| Public GET `/api/menu` | 200; also confirms application DB/menu connectivity |
| Public GET `/api/payment/config` | 503 |
| Public GET `/api/admin/orders` without credentials | 401, expected |
| Public GET `/track` | 404 |
| Loopback GET `/api/employee/orders/active` | 404 |
| Loopback GET `/api/orders/mine` without credentials | 401, expected |
| Public HEAD `/` | 404; deployed Node implementation handles GET but not HEAD |

The payment configuration handler was inspected directly. It returns 503 when
`STRIPE_PUBLISHABLE_KEY` is absent. The deployed card-checkout flow depends on
this endpoint, so current Stripe checkout is blocked. No payment was attempted.

The skipped test performs database inserts and rollback. It was deliberately
disabled to honor the requested read-only scope. No customer order was submitted,
advanced or archived. The new FastAPI tests cannot run on this server until the
new source and its isolated dependencies are installed. Earlier local verification
of the new source recorded 33 Node tests and 9 API tests passing; those API tests
used a SQLite adapter and do not validate the live MariaDB migration.

## Actions required for the requested mock/pickup ordering flow

1. Back up the current deployment and database into protected files. Verify the
   database backup can be restored into an isolated test database.
2. Upload the prepared lifecycle source and `db/002_lifecycle.sql`, retaining
   existing protected configuration. Stage it separately before replacing the
   running application. Preserve teammate-owned account and analytics modules.
3. Install Debian venv support and create a dedicated lifecycle virtual environment.
   Install the runtime dependencies from `ordering/lifecycle/requirements.txt`,
   plus test dependencies in the test environment.
4. Apply and verify the one-time migration against the isolated restored database,
   then run API/database integration tests. Only after those succeed should the
   live database receive the migration.
5. Configure SITE_URL as `https://luigispizza.duckdns.org`, Node's LIFECYCLE_URL as
   `http://127.0.0.1:8000`, and the approved TAX_BASIS_POINTS. Reuse the existing
   protected DB/staff settings without displaying passwords. Verify application
   table grants for the new service. Choose SMTP delivery or the documented local
   receipt logging fallback; receipt logs contain contact details and tracker links.
6. Install a persistent systemd service for FastAPI on loopback port 8000 using
   the repository root as its working directory. Start it, deploy the Node/frontend
   changes and restart the existing Node service. The observed nginx `/` proxy can
   continue forwarding through Node; opening port 8000 to the internet is unnecessary.
7. Verify the public routes, staff authorization, and the entire test-order lifecycle:
   pickup/mock submission, receipt, retry, tracking, estimate, each advancement and
   archive. This final end-to-end check writes an explicitly identified test order
   and requires permission beyond read-only diagnostics. SMTP tests can send mail
   and should use an explicitly authorized test recipient.

The requested mock online flow does not need Stripe keys and must not charge a
card. If real Stripe checkout is desired instead, that is a separate choice that
requires its payment settings and provider verification; the lifecycle sprint
explicitly requests mock online payment and payment at pickup.

## Permissions and information needed before deployment

The audit itself required no additional permissions; existing sudo access supported
the read-only schema and nginx checks. The user's latest scope permits read-only
commands, so approval is needed for server backups/uploads, package installation,
creation of an isolated test database, production DDL, protected configuration edits,
service installation/restarts and creation of a labeled smoke-test order. Deployment
can cause a short interruption during the Node restart. The approved tax rate is
also required; a location-specific rate should not be guessed.

See [LIFECYCLE.md](./LIFECYCLE.md) for dependency and migration instructions, including
what the commands do, expected success/failure output and sudo requirements.

## Authorized deployment attempt

The user approved deployment and specified 9.75% tax (975 basis points).
A protected source, database and environment backup completed at
`/var/backups/luigis-lifecycle/20261016T013424Z` on the VM. The command used
`set -e` and a restrictive umask; it printed the backup directory only after
the database dump, source archive and environment copy all completed.

The local release archive is `luigis-lifecycle-deployment.zip` (67,763 bytes),
SHA-256 `57a32d2333682617fd5044c37201f9a84883cb3446414dcb3d368cb35d1a8365`.
Repeated home-directory checks found no transferred archive. The Google SSH
file-upload attempt opened an authentication popup and ultimately displayed
“SSH authentication has failed.” Reauthorizing the shell restored the terminal
but did not fix the transfer. No source files, database schema, packages or
services were updated. No production test order was created.

Deployment remains pending a working file transfer/SSH connection. Once access
is restored, confirm the archive checksum before extracting or executing it.
Before activating the prepared helper, ensure newly created application
directories are traversable by the unprivileged service user: the helper uses
a restrictive umask. Existing application directories must retain their intended
permissions; do not relax the permissions on backups or `/etc/luigis.env`.
