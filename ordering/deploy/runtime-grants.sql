-- Run with sudo mariadb AFTER all migrations; does not create/change the user's password.
GRANT SELECT,INSERT,UPDATE ON luigis.customers TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,UPDATE ON luigis.orders TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,DELETE ON luigis.order_items TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT ON luigis.order_events TO 'luigis_app'@'127.0.0.1';
GRANT SELECT ON luigis.menu_prices TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,UPDATE ON luigis.accounts TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,DELETE ON luigis.account_sessions TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,DELETE ON luigis.account_actions TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,UPDATE ON luigis.account_order_claims TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,UPDATE,DELETE ON luigis.account_mail TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,UPDATE,DELETE ON luigis.account_throttles TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT ON luigis.account_audit TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,UPDATE ON luigis.checkout_reservations TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,UPDATE ON luigis.stripe_payments TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT ON luigis.stripe_events TO 'luigis_app'@'127.0.0.1';
GRANT SELECT,INSERT,UPDATE ON luigis.stripe_refunds TO 'luigis_app'@'127.0.0.1';
