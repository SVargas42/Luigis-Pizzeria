-- Run once against the existing luigis schema after the diagnostics in LIFECYCLE.md.
ALTER TABLE orders
 ADD tracking_token CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL UNIQUE,
 ADD tracking_status ENUM('order_received','order_confirmed','preparing_order','cooking_order','order_ready') NULL,
 ADD payment_status ENUM('pending','authorized_mock','unpaid') NULL,
 ADD subtotal_cents INT UNSIGNED NULL,
 ADD tax_cents INT UNSIGNED NULL,
 ADD estimated_pickup_time DATETIME NULL,
 MODIFY payment_method ENUM('pay_at_pickup','card','online','in_store') NOT NULL DEFAULT 'card';
CREATE INDEX lifecycle_queue ON orders(status,tracking_status,created_at);
