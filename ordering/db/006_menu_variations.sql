-- Apply once after 005_menu.sql, after backing up menu_prices and order_items.
USE luigis;

CREATE TABLE menu_variations (
    category VARCHAR(20) NOT NULL,
    name VARCHAR(80) NOT NULL,
    size VARCHAR(20) NOT NULL,
    price_cents INT UNSIGNED NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    PRIMARY KEY (category, name, size),
    FOREIGN KEY (category, name) REFERENCES menu_prices(category, name)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE order_items
    ADD COLUMN size VARCHAR(20) NULL DEFAULT NULL;

INSERT INTO menu_variations (category, name, size, price_cents)
VALUES
    ('side', 'Breadsticks', 'Small', 400),
    ('side', 'Breadsticks', 'Medium', 500),
    ('side', 'Breadsticks', 'Large', 600);
