# Accounts, authentication and reverse proxy

The complete release includes the existing account implementation: required first/last name, email and phone; salted scrypt password hashes; email verification and recovery; expiring hashed session tokens; HttpOnly/SameSite cookies (Secure on HTTPS); logout/revocation; customer-owned order history; invited administrator accounts; administrator-only orders, analytics and refunds; origin checks and database-backed throttling. Public registration cannot select the administrator role. Signup requires Resend configuration. Guest checkout remains available.

Use the complete project, preserving your private `.env`. The previous VS Code copy inspected on October 18 still had the guest-only identity hook. Copying only `identity.js` does not install authentication: server, account service, pages, schema and helper files must match. Run `npm ci --ignore-scripts` after updating dependencies.

## Database and admin

For a NEW EMPTY database import `schema.sql`, `002_lifecycle.sql`, `003_accounts.sql`, then `004_stripe.sql` in that order. For an existing database back it up and apply only missing migrations; do not rerun the base schema or 002 blindly. Follow the database grants in ACCOUNTS_RELEASE.md and STRIPE_SETUP.md. Never drop an existing database to resolve a duplicate-column error.

From ordering, bootstrap the first admin with `node --env-file=.env scripts/create-admin.js`. This prompts for a real profile and a hidden password; `.env` ADMIN_USER/ADMIN_PASSWORD are private Node-to-Python credentials, not website login credentials. Sign in at `/account`, then open `/admin` and `/admin/accounts`.

## Debian Nginx and HTTPS

This setup assumes Nginx is directly exposed on the same VM as Node, with DNS pointing to that VM. If a load balancer or CDN is already in front, its trusted proxy configuration needs a separate review. Keep Node on 127.0.0.1:3000 and Python on 127.0.0.1:8000; do not publicly expose MariaDB or the Python service. Nginx proxies every application route through Node so authentication cannot be bypassed.

1. Point one real domain's DNS A record to the VM's static public IP. Add AAAA only if working IPv6 is configured. Permit public TCP 80 and 443 in the applicable GCP firewall rules and VM firewall, preserving SSH access.
2. Install packages:

```bash
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

3. From the complete project's ordering directory, replace the example hostname with your real hostname. Generate a configuration and inspect it BEFORE installing it:

```bash
cd "$HOME/Luigis-Pizzeria/ordering"
node deploy/render-nginx.js orders.yourdomain.com > /tmp/luigis-nginx.conf
cat /tmp/luigis-nginx.conf
```

Only continue if the renderer succeeded and the file contains your hostname. The renderer rejects schemes, ports, paths and configuration injection.

```bash
sudo install -m 644 /tmp/luigis-nginx.conf /etc/nginx/sites-available/luigis
sudo ln -s /etc/nginx/sites-available/luigis /etc/nginx/sites-enabled/luigis
sudo nginx -t
```

If that symlink already exists, skip its creation. If `nginx -t` fails, stop and correct the reported issue before reloading. If this VM already hosts the same domain, edit its existing server block instead of installing a duplicate. Do not delete other hosted sites.

```bash
sudo systemctl enable --now nginx
sudo systemctl reload nginx
sudo certbot --nginx -d orders.yourdomain.com --redirect
sudo certbot renew --dry-run
```

Certbot requires the real domain to resolve and be publicly reachable. The HTTP configuration is a bootstrap for certificate issuance; do not use accounts on public HTTP.

4. Edit ordering/.env (preserve all DB, internal service, mail and Stripe settings):

```dotenv
HOST=127.0.0.1
PORT=3000
SITE_URL=https://orders.yourdomain.com
LIFECYCLE_URL=http://127.0.0.1:8000
TRUST_PROXY_LOOPBACK=1
```

Use the exact canonical HTTPS origin without a path. Nginx overwrites X-Real-IP and forwarding headers, making per-client authentication throttles work through the loopback proxy. Both systemd services must read the same `.env`. Configure RESEND_API_KEY and a verified ACCOUNT_MAIL_FROM for registration/recovery. Keep STRIPE_ENABLED=0 until sandbox keys/webhooks have been tested; Stripe uses the same public origin.

```bash
sudo systemctl restart luigis-lifecycle luigis-web
sudo nginx -t
curl -I http://orders.yourdomain.com
curl -i https://orders.yourdomain.com/api/session
curl -i https://orders.yourdomain.com/api/admin/orders
```

Expected: HTTP redirects to HTTPS; guest session is unauthenticated; unauthenticated admin API returns 403. These assume the systemd units from the Debian setup instructions are installed. A missing unit means service installation is still required, not an Nginx issue.

## Validation

```bash
npm test
RUN_DB_TEST=1 node --env-file=.env --test test/database.live.test.js test/accounts.live.test.js test/payments.live.test.js
```

Then use the HTTPS site to verify registration, delivery of verification mail, login, logout, password reset, customer order isolation, administrator orders/analytics, and staff invitations. Check the session cookie has HttpOnly, Secure and SameSite=Lax in browser developer tools. Verify /admin and /admin/accounts redirect guests to sign-in and ordinary customers cannot use admin APIs. A nonmatching Origin on browser writes must return 403. Confirm the Stripe signed webhook endpoint remains accessible if Stripe is enabled; do not protect the entire website using Nginx Basic Auth.

Local automated tests validate the proxy renderer and account flows. Actual Nginx syntax, TLS issuance, email delivery and real MariaDB behavior must also be checked on Debian; they are not established by offline tests.

References: https://nginx.org/en/docs/http/ngx_http_proxy_module.html ; https://certbot.eff.org/instructions ; https://manpages.debian.org/bookworm/certbot/certbot.7.en.html
