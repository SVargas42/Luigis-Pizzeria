"""Phase A schema checks only; no production records are used."""
import sqlite3
from pathlib import Path

import pytest


def test_breadstick_variation_migration_preserves_history_and_relationships():
    with sqlite3.connect(':memory:') as objConnection:
        objConnection.executescript('''
            PRAGMA foreign_keys=ON;
            CREATE TABLE menu_prices(category TEXT,name TEXT,price_cents INTEGER,
                is_active INTEGER DEFAULT 1,PRIMARY KEY(category,name));
            INSERT INTO menu_prices VALUES('side','Breadsticks',500,1);
            CREATE TABLE order_items(id INTEGER PRIMARY KEY,description TEXT,
                quantity INTEGER,unit_price_cents INTEGER);
            INSERT INTO order_items VALUES(1,'Breadsticks',2,500);
        ''')
        strSql = (Path(__file__).parents[2] / 'db' / '006_menu_variations.sql').read_text()
        # SQLite omits MariaDB's database selection and storage-engine options.
        strSql = strSql.replace('USE luigis;', '').replace(
            ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;', ');')
        objConnection.executescript(strSql)
        assert objConnection.execute('SELECT size,price_cents,is_active FROM menu_variations ORDER BY price_cents').fetchall() == [
            ('Small', 400, 1), ('Medium', 500, 1), ('Large', 600, 1)]
        assert objConnection.execute('SELECT * FROM order_items').fetchall() == [(1, 'Breadsticks', 2, 500, None)]
        with pytest.raises(sqlite3.IntegrityError):
            objConnection.execute("INSERT INTO menu_variations VALUES('side','Breadsticks','Small',400,1)")
        with pytest.raises(sqlite3.IntegrityError):
            objConnection.execute("INSERT INTO menu_variations VALUES('side','Missing','Small',400,1)")
        with pytest.raises(sqlite3.IntegrityError):
            objConnection.execute("UPDATE menu_variations SET is_active=2")
        objConnection.execute("UPDATE menu_prices SET name='Garlic Breadsticks'")
        assert objConnection.execute("SELECT COUNT(*) FROM menu_variations WHERE name='Garlic Breadsticks'").fetchone()[0] == 3
        with pytest.raises(sqlite3.IntegrityError):
            objConnection.execute('DELETE FROM menu_prices')
        objConnection.execute('UPDATE menu_prices SET is_active=0')
        assert objConnection.execute('SELECT COUNT(*) FROM menu_variations').fetchone()[0] == 3
