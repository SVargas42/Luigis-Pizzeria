# Live deployment result — October 15, 2026 (America/Los_Angeles)

The lifecycle update is live at **https://luigispizza.duckdns.org**. The real staff
dashboard is **https://luigispizza.duckdns.org/admin** (without the demo query).
The approved sales-tax rate is **9.75%**, stored as `TAX_BASIS_POINTS=975`.

## Changes applied

- Verified the uploaded archive checksum and checked that the affected live files
  matched the inspected repository baseline before staging replacements.
- Created protected source, configuration and database backups. Restored a backup
  into an isolated MariaDB database and tested the additive migration there first.
- Installed Debian Python venv support and the approved Python packages in
  `/opt/luigis-lifecycle-venv`; no system Python pip installation was needed.
- Applied `ordering/db/002_lifecycle.sql` to the live `luigis` database, preserving
  legacy order and Stripe fields.
- Deployed checkout, receipts, tracker, staff queue, estimates and advancement controls.
- Set the public origin, loopback lifecycle URL and approved tax rate in the
  existing protected `/etc/luigis.env`, preserving database/staff credentials.
- Installed and enabled `luigis-lifecycle.service` using the existing unprivileged
  `luigis` account. Restarted the existing Node service after staging checks passed.
- Preserved the existing nginx route and teammate-owned identity/analytics modules.

## Verification results

| Check | Result |
| --- | --- |
| Updated Node suite on the VM | 33 passed, 0 failed, 1 legacy database-write test skipped |
| Updated API regression suite on the VM | 10 passed, 0 failed |
| Backup restore and migration on isolated MariaDB | Passed |
| Pickup and mock-online receipt, tax, retry and tracker integration | Passed on MariaDB |
| Simultaneous retries using the same request key | Passed; one order created |
| Injected database failure during item insertion | Passed; order/contact/item writes rolled back |
| Public HTTPS homepage, menu and tracker-page requests | Passed |
| Public authenticated kitchen queue/status/estimate/archive APIs | Passed |
| Public unauthenticated kitchen queue | 401 as expected |
| Public test order LP-1 | Receipt, 9.75% tax, retry, estimate, all five stages and archive passed |
| Receipt fallback | One matching deployment receipt log entry verified without printing its token |
| Services | `luigis` and `luigis-lifecycle` active; lifecycle service enabled for startup |
| Network listeners | Node 3000, FastAPI 8000 and MariaDB 3306 all on `127.0.0.1` |

The MariaDB concurrency test initially exposed an InnoDB deadlock that SQLite
tests did not reproduce. Checkout now retries only deadlock-victim errors (1213),
at most three attempts, after the transaction context has rolled back. The fix
and a regression test are included locally and in the deployed source. Staging
and the actual MariaDB integration passed after the fix. Deployment verification
was also made repeatable, and creation of application directories now preserves
service-readable permissions despite the deployment helper's restrictive umask.

The Python test run reported dependency deprecation warnings for HTTPX/TestClient
and SQLite's default datetime adapters. These did not fail the tests or affect
the MySQL-backed live service. The skipped legacy DB test was replaced for this
deployment by the explicit isolated MariaDB integration checks above.

## Staff navigation follow-up

The homepage Admin Orders button still pointed to `/admin?demo=1&tab=current`,
which displayed sample orders. Changed that one link to `/admin?tab=current`
locally and on the live server without a restart. Existing staff authentication
remains required. The authenticated public queue returned order LP-2 with
`order_received`, matching the live database. The updated local Node suite passed
34 tests with one legacy database test skipped. The live homepage backup is
`/opt/luigis/index.html.live-queue-backup`.

## Payment and receipt behavior

Online payment is the requested **mock** flow; it does not collect or charge cards.
Pickup orders remain unpaid until collected. Existing Stripe routes remain in
source but are not used by the new checkout.

**SMTP is not configured.** Receipt dispatch currently uses the implemented local
logging fallback. Actual receipt emails require an SMTP host/from address and any
required credentials, followed by an authorized test recipient check. Receipt logs
and backups contain contact details and bearer tracker links; their existing access
restrictions should be retained. Background mail dispatch is best-effort in process.

LP-1 is clearly labeled `DEPLOYMENT TEST / DO NOT PREPARE` and was archived. It is
retained in past orders as the authorized verification record; no real charge occurred.

## Recovery and staging records on the VM

- Deployment backup: `/var/backups/luigis-lifecycle/20261016T015748Z`
- Earlier predeployment backup: `/var/backups/luigis-lifecycle/20261016T013424Z`
- Final pre-migration dump: the deployment backup's `database-before-migration.sql`
- Protected deployment state: `/var/backups/luigis-lifecycle/deployment.json`
- Verified stage: `/opt/luigis-staging/20261016T015748Z`
- Isolated test DB: `luigis_lifecycle_check_20261016t015748z`
- Runtime source: `/opt/luigis`
- Runtime environment: `/etc/luigis.env` (root-owned, mode 600)
- Service definition: `/etc/systemd/system/luigis-lifecycle.service`

Backups and the test database remain available for review/recovery. No cleanup or
automatic deletion was performed. Restore planning must account for orders placed
after deployment; do not blindly restore an old database dump over live orders.

The initial archive was transferred through Cloud Shell after SSH-in-browser uploads
failed. The three repaired source/test files were then updated in the protected stage
and its hash manifest before live activation. The local ZIP has been refreshed to
include those verified repairs; the earlier transferred ZIP alone predates them.

For routine health checks, `systemctl is-active luigis luigis-lifecycle` reports two
`active` lines when healthy, and `systemctl is-enabled luigis-lifecycle` should report
`enabled`. Both commands are read-only and require no sudo. Other statuses require
investigation. See [LIFECYCLE.md](./LIFECYCLE.md) for configuration and command details.
