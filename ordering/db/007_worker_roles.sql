-- Add a shared worker permission level; each employee keeps an individual account.
-- This migration preserves existing account IDs, passwords and roles.
ALTER TABLE accounts MODIFY COLUMN role ENUM('customer','admin','worker') NOT NULL DEFAULT 'customer';
