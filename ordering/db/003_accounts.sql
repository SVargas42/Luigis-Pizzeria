-- Apply after schema.sql and 002_lifecycle.sql. Does not claim historical guest orders.
CREATE TABLE IF NOT EXISTS accounts (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL UNIQUE,
 first_name VARCHAR(80) NOT NULL,
 last_name VARCHAR(80) NOT NULL,
 phone VARCHAR(30) NOT NULL,
 password_hash VARCHAR(255) NULL,
 role ENUM('customer','admin') NOT NULL DEFAULT 'customer',
 email_verified_at DATETIME NULL,
 disabled_at DATETIME NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS account_sessions (
 token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 account_id BIGINT UNSIGNED NOT NULL,
 expires_at DATETIME NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY session_account(account_id), KEY session_expiry(expires_at),
 CONSTRAINT session_account_fk FOREIGN KEY(account_id) REFERENCES accounts(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS account_actions (
 token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 account_id BIGINT UNSIGNED NOT NULL,
 purpose ENUM('verify','reset','invite') NOT NULL,
 expires_at DATETIME NOT NULL,
 KEY action_account(account_id),
 CONSTRAINT action_account_fk FOREIGN KEY(account_id) REFERENCES accounts(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS account_order_claims (
 request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 account_id BIGINT UNSIGNED NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY claims_account(account_id),
 CONSTRAINT claims_account_fk FOREIGN KEY(account_id) REFERENCES accounts(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS account_mail (
 id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 recipient VARCHAR(254) NOT NULL,
 subject VARCHAR(120) NOT NULL,
 message TEXT NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
 next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 sent_at DATETIME NULL,
 KEY pending_mail(sent_at,next_attempt_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS account_throttles (
 bucket CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 attempts INT UNSIGNED NOT NULL DEFAULT 0,
 expires_at DATETIME NOT NULL,
 KEY throttle_expiry(expires_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS account_audit (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 actor_id BIGINT UNSIGNED NULL,
 target_id BIGINT UNSIGNED NULL,
 action VARCHAR(40) NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY audit_actor(actor_id,created_at)
) ENGINE=InnoDB;
