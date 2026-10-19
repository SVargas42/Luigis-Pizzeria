-- Read-only diagnostics. These identify presence, not full migration correctness.
SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='luigis';
SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='luigis' ORDER BY TABLE_NAME;
SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='luigis' AND ((TABLE_NAME='orders' AND COLUMN_NAME IN
('tracking_token','tracking_status','payment_status','subtotal_cents','tax_cents','estimated_pickup_time','payment_method','refunded_cents'))
OR (TABLE_NAME='account_mail' AND COLUMN_NAME='purpose')) ORDER BY TABLE_NAME,COLUMN_NAME;
SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='luigis' AND TABLE_NAME='orders' AND INDEX_NAME='lifecycle_queue' GROUP BY INDEX_NAME;
SELECT User,Host FROM mysql.user WHERE User='luigis_app';
