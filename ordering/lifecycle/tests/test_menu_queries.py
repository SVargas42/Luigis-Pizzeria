"""Exercise the migration and production queries against an isolated SQL store."""
import sqlite3
from pathlib import Path

import pytest

from ordering.lifecycle.menu_queries import (
    strActiveMenuQuery, strAdminMenuQuery, strInsertMenuQuery,
    strUpdateMenuQuery, strDeleteMenuQuery,
)


def test_menu_migration_queries_and_history():
    with sqlite3.connect(':memory:') as objConnection:
        objConnection.executescript('''
            CREATE TABLE menu_prices(category VARCHAR(20),name VARCHAR(80),
                price_cents INT NOT NULL,PRIMARY KEY(category,name));
            INSERT INTO menu_prices VALUES('topping','Pepperoni',150);
            CREATE TABLE order_items(description TEXT,unit_price_cents INT);
            INSERT INTO order_items VALUES('Small pizza with Pepperoni',1150);
        ''')
        strMigration = (Path(__file__).parents[2] / 'db' / '005_menu.sql').read_text()
        # SQLite has no USE statement; execute the unchanged ALTER statements.
        objConnection.executescript(strMigration.replace('USE luigis;', ''))
        assert objConnection.execute(strAdminMenuQuery).fetchone() == (
            'topping', 'Pepperoni', '', 150, 1)
        with pytest.raises(sqlite3.IntegrityError):
            objConnection.execute('UPDATE menu_prices SET is_active=2')
        objConnection.execute(strInsertMenuQuery.replace('%s', '?'),
                              ('side', 'Garlic Knots', 'Fresh garlic', 700))
        assert objConnection.execute('SELECT is_active FROM menu_prices WHERE category=?',
                                     ('side',)).fetchone() == (1,)
        objConnection.execute(strUpdateMenuQuery.replace('%s', '?'),
                              ('Garlic Bites', 'Roasted garlic', 800, 'side', 'Garlic Knots'))
        assert ('side', 'Garlic Bites', 'Roasted garlic', 800) in objConnection.execute(
            strActiveMenuQuery).fetchall()
        assert objConnection.execute(strDeleteMenuQuery.replace('%s', '?'),
                                     ('topping', 'Pepperoni')).rowcount == 1
        assert objConnection.execute(strActiveMenuQuery).fetchall() == [
            ('side', 'Garlic Bites', 'Roasted garlic', 800)]
        assert len(objConnection.execute(strAdminMenuQuery).fetchall()) == 2
        assert objConnection.execute(strUpdateMenuQuery.replace('%s', '?'),
                                     ('Other', '', 200, 'topping', 'Pepperoni')).rowcount == 0
        assert objConnection.execute(strDeleteMenuQuery.replace('%s', '?'),
                                     ('topping', 'Pepperoni')).rowcount == 0
        with pytest.raises(sqlite3.IntegrityError):
            objConnection.execute(strInsertMenuQuery.replace('%s', '?'),
                                  ('topping', 'Pepperoni', '', 200))
        assert objConnection.execute('SELECT * FROM order_items').fetchall() == [
            ('Small pizza with Pepperoni', 1150)]
