"""Parameterized menu queries; callers must authorize mutations before executing."""

strActiveMenuQuery = '''SELECT category,name,description,price_cents
FROM menu_prices WHERE is_active = 1 ORDER BY category,name'''

strAdminMenuQuery = '''SELECT category,name,description,price_cents,is_active
FROM menu_prices ORDER BY category,name'''

strInsertMenuQuery = '''INSERT INTO menu_prices
(category,name,description,price_cents,is_active) VALUES (%s,%s,%s,%s,1)'''

strUpdateMenuQuery = '''UPDATE menu_prices SET name=%s,description=%s,price_cents=%s
WHERE category=%s AND name=%s AND is_active = 1'''

strDeleteMenuQuery = '''UPDATE menu_prices SET is_active=0
WHERE category=%s AND name=%s AND is_active = 1'''

strLockMenuQuery = '''SELECT category,name,description,price_cents,is_active
FROM menu_prices WHERE category=%s AND name=%s AND is_active = 1 FOR UPDATE'''
