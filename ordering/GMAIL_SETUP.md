# Gmail delivery for Luigi's Pizza

Sender: l7163747@gmail.com. Website stays at https://luigispizza.duckdns.org . No database migration is needed. MAIL_PROVIDER=smtp enables SMTP for verification, recovery, invitations and card receipt outbox mail; Python pickup receipts use the same SMTP credentials. Existing Resend mode remains supported when MAIL_PROVIDER=resend or unset.

Install the matching mail.js, accounts.js, server.js, package.json/lockfile, deploy/check-env.js and helper/test files. Preserve all other current project changes (including menu integration). Run npm ci --ignore-scripts and npm test. The full email update was tested without sending real email. SMTP is encrypted with STARTTLS on port 587 and certificate validation; no protocol debug logging is enabled.

## Private VM setup

Create a Google app password with 2-Step Verification enabled. Do not send it in chat or use your normal Google password. In browser SSH, after uploading the update:

```bash
cd /opt/luigis/ordering
sudo /usr/local/bin/node scripts/configure-gmail.js /etc/luigis.env
```

The command reads the app password without echo and updates only the mail configuration for the selected Gmail address. Existing DB and internal service credentials remain unchanged. To enter the settings manually, use sudo nano /etc/luigis.env and set:

```dotenv
MAIL_PROVIDER=smtp
ACCOUNT_MAIL_FROM="Luigi Accounts <l7163747@gmail.com>"
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_FROM=l7163747@gmail.com
SMTP_USER=l7163747@gmail.com
SMTP_PASSWORD="YOUR_GOOGLE_APP_PASSWORD"
```

Resend credentials are not required in SMTP mode. Keep SMTP_PASSWORD private; production config stays root:luigis with mode 0640.

```bash
sudo -u luigis /usr/local/bin/node --env-file=/etc/luigis.env scripts/verify-smtp.js
sudo systemctl restart luigis-lifecycle luigis
```

Verification checks connection/TLS/authentication without sending a message. A successful SMTP handshake does not guarantee inbox delivery. With your permission, test a real message, then register/verify a real account and test recovery and receipts. Don't consider email operational until a real message arrives (check spam too).

Gmail quotas and security checks apply. Consider a domain and transactional provider before substantial customer traffic. SMTP has no provider idempotency guarantee: a retry after uncertain acceptance can duplicate a message despite the stable Message-ID. Account/card mail uses the existing database outbox/retries; pickup SMTP remains best-effort without a durable retry queue. Google app password availability depends on account policy; if unavailable, use an OAuth2 integration instead of weakening Google account protection.

References: https://nodemailer.com/smtp ; https://support.google.com/accounts/answer/185833 ; https://support.google.com/mail/answer/22839 .
