# Edit Menu release — awaiting production approval

Phases B and C are implemented locally. Phase A's production schema and grants
are already applied. This release adds description editing, active/removed
listing, protected FastAPI CRUD and the exact two-step delete confirmation.
Deletion retains the menu row and historical orders.

Local checks: 93 Node tests passed (including isolated Chrome workflows),
47 Python tests passed; 3 live MariaDB tests skipped. After the final mobile
keyboard-scroll adjustment, all 9 focused browser/dashboard checks passed.
Desktop/mobile previews were visually inspected. Browser tests use an isolated
local fixture; Python database tests use SQLite. Existing Python deprecation
warnings remain. Live authenticated admin testing still requires an account;
the last inspected production accounts table was empty.

## Files

The release archive contains exactly six runtime files, four original Git
versions under baseline/, and a SHA256SUMS integrity manifest. It contains no
environment files, credentials, dependencies, database dumps or order records.

- ordering/server.js
- ordering/payments.js
- ordering/menu-proxy.js (new)
- ordering/lifecycle/app.py
- ordering/lifecycle/menu_queries.py (new)
- ordering/public/admin.html

## Exact commands proposed for approval

After approval, upload luigis-menu-release.zip through the existing SSH browser
to /home/ellishiett/luigis-menu-release.zip. This creates a new staging archive,
not an application-file replacement. Run the block below in the SSH session.
It aborts on errors; the subshell keeps the SSH shell open on failure.

```sh
(
set -e
mkdir /home/ellishiett/luigis-menu-release
python3 -m zipfile -e /home/ellishiett/luigis-menu-release.zip /home/ellishiett/luigis-menu-release
cd /home/ellishiett/luigis-menu-release
sha256sum -c SHA256SUMS
test "$(systemctl show luigis -p User --value)" = luigis
test "$(systemctl show luigis-lifecycle -p User --value)" = luigis
test ! -e /opt/luigis/ordering/menu-proxy.js
test ! -e /opt/luigis/ordering/lifecycle/menu_queries.py
for strFile in ordering/server.js ordering/payments.js ordering/lifecycle/app.py ordering/public/admin.html; do
    diff --strip-trailing-cr "baseline/$strFile" "/opt/luigis/$strFile"
done
sudo mkdir -m 700 /var/backups/luigis/menu-release
for strFile in ordering/server.js ordering/payments.js ordering/lifecycle/app.py ordering/public/admin.html; do
    sudo cp -a --parents "/opt/luigis/$strFile" /var/backups/luigis/menu-release
done
for strFile in ordering/server.js ordering/payments.js ordering/menu-proxy.js ordering/lifecycle/app.py ordering/lifecycle/menu_queries.py ordering/public/admin.html; do
    sudo install -o root -g luigis -m 640 "$strFile" "/opt/luigis/$strFile"
done
sudo -u luigis /usr/local/bin/node --check /opt/luigis/ordering/server.js
sudo -u luigis /usr/local/bin/node --check /opt/luigis/ordering/menu-proxy.js
sudo -u luigis /usr/local/bin/node --check /opt/luigis/ordering/payments.js
cd /opt/luigis
sudo -u luigis /opt/luigis-lifecycle-venv/bin/python -B -c 'import ordering.lifecycle.app'
sudo systemctl restart luigis-lifecycle.service
sudo systemctl restart luigis.service
)
```

Any difference from the original files stops the release before application
writes so teammate changes can be reviewed and merged. Existing targets are
backed up with ownership/modes preserved under
/var/backups/luigis/menu-release/opt/luigis/ordering/. The two new modules must
not already exist. The install loop above is the exact application write
command; it grants the service read access without changing the shared env.
No Nginx restart, additional migration or production test-order write is included.
Restarting the two applications may briefly interrupt requests. If a command
fails after installation starts, stop and report the actual state before any
further writes or recovery commands.

Afterward, perform read-only service, public-menu and authorization checks.
Do not submit live menu edits or orders without separate authorization.
