-- Apply once after 004_stripe.sql; MariaDB DDL auto-commits.
USE luigis;

ALTER TABLE menu_prices
    ADD COLUMN description VARCHAR(1000) NOT NULL DEFAULT '';

ALTER TABLE menu_prices
    ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1
        CHECK (is_active IN (0, 1));
