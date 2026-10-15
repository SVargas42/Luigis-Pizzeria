CREATE DATABASE IF NOT EXISTS luigis CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE luigis;
CREATE TABLE IF NOT EXISTS customers (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 first_name VARCHAR(80) NOT NULL,
 last_name VARCHAR(80) NOT NULL,
 email VARCHAR(254) NOT NULL,
 phone VARCHAR(30) NOT NULL DEFAULT '',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY customer_email (email)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS menu_prices (
 category VARCHAR(20) NOT NULL,
 name VARCHAR(80) NOT NULL,
 price_cents INT UNSIGNED NOT NULL,
 PRIMARY KEY(category,name)
) ENGINE=InnoDB;
INSERT IGNORE INTO menu_prices VALUES
 ('pizza','Small',1000),('pizza','Medium',1300),('pizza','Large',1600),
 ('topping','Cheese',150),('topping','Pepperoni',150),('topping','Sausage',150),
 ('topping','Pineapple',150),('topping','Olives',150),('topping','Barbeque Chicken',150),
 ('side','Breadsticks',500),('side','Pizza Bites',600),
 ('drink','Small',200),('drink','Medium',275),('drink','Large',350);
CREATE TABLE IF NOT EXISTS orders (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
 customer_id BIGINT UNSIGNED NOT NULL,
 customer_name VARCHAR(161) NOT NULL,
 customer_email VARCHAR(254) NOT NULL,
 customer_phone VARCHAR(30) NOT NULL,
 status ENUM('received','preparing','ready','completed','cancelled') NOT NULL DEFAULT 'received',
 payment_method ENUM('pay_at_pickup','card') NOT NULL DEFAULT 'card',
 stripe_session_id VARCHAR(255) NULL UNIQUE,
 total_cents INT UNSIGNED NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 KEY queue_status_date(status,created_at),
 KEY customer_history(customer_id,created_at),
 CONSTRAINT order_customer FOREIGN KEY(customer_id) REFERENCES customers(id)
) ENGINE=InnoDB;
ALTER TABLE orders MODIFY payment_method ENUM('pay_at_pickup','card') NOT NULL DEFAULT 'card';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_session_id VARCHAR(255) NULL UNIQUE;
CREATE TABLE IF NOT EXISTS order_items (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 order_id BIGINT UNSIGNED NOT NULL,
 kind ENUM('pizza','side','drink') NOT NULL,
 description VARCHAR(500) NOT NULL,
 quantity SMALLINT UNSIGNED NOT NULL,
 unit_price_cents INT UNSIGNED NOT NULL,
 CONSTRAINT item_order FOREIGN KEY(order_id) REFERENCES orders(id),
 CONSTRAINT quantity_positive CHECK(quantity BETWEEN 1 AND 10)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS order_events (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
 order_id BIGINT UNSIGNED NOT NULL,
 actor_email VARCHAR(254) NULL,
 event_type ENUM('created','status_changed','items_edited') NOT NULL,
 from_status ENUM('received','preparing','ready','completed','cancelled') NULL,
 to_status ENUM('received','preparing','ready','completed','cancelled') NULL,
 details VARCHAR(500) NOT NULL DEFAULT '',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY order_event_history(order_id,created_at),
 CONSTRAINT event_order FOREIGN KEY(order_id) REFERENCES orders(id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS pending_checkouts (
 request_key CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 stripe_session_id VARCHAR(255) NULL UNIQUE,
 payload_json JSON NOT NULL,
 total_cents INT UNSIGNED NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
