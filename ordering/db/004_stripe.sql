-- Requires schema.sql, 002_lifecycle.sql, and 003_accounts.sql.
ALTER TABLE orders MODIFY payment_status ENUM('pending','authorized_mock','unpaid','paid','partially_refunded','refunded') NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS refunded_cents INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE account_mail ADD COLUMN IF NOT EXISTS purpose ENUM('account','receipt') NOT NULL DEFAULT 'account';
CREATE TABLE IF NOT EXISTS checkout_reservations (
 request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 channel ENUM('pickup','stripe') NOT NULL,
 account_id BIGINT UNSIGNED NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT checkout_reservation_account_fk FOREIGN KEY(account_id) REFERENCES accounts(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS stripe_payments (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 account_id BIGINT UNSIGNED NULL,
 access_token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 input_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 quote_json JSON NOT NULL,
 params_json JSON NOT NULL,
 stripe_session_id VARCHAR(255) NULL UNIQUE,
 stripe_payment_intent_id VARCHAR(255) NULL UNIQUE,
 state ENUM('creating','open','paid','expired','failed') NOT NULL DEFAULT 'creating',
 order_id BIGINT UNSIGNED NULL UNIQUE,
 refunded_cents INT UNSIGNED NOT NULL DEFAULT 0,
 expires_at DATETIME NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY payment_account(account_id,created_at), KEY payment_reconcile(state,updated_at),
 CONSTRAINT stripe_account_fk FOREIGN KEY(account_id) REFERENCES accounts(id),
 CONSTRAINT stripe_order_fk FOREIGN KEY(order_id) REFERENCES orders(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS stripe_events (
 event_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 event_type VARCHAR(100) NOT NULL,
 payment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
 processed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY event_payment(payment_id,processed_at),
 CONSTRAINT stripe_event_payment_fk FOREIGN KEY(payment_id) REFERENCES stripe_payments(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS stripe_refunds (
 stripe_refund_id VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 payment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 amount_cents INT UNSIGNED NOT NULL,
 status VARCHAR(30) NOT NULL,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 CONSTRAINT refund_payment_fk FOREIGN KEY(payment_id) REFERENCES stripe_payments(id)
) ENGINE=InnoDB;
