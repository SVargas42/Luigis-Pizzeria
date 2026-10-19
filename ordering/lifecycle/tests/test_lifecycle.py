"""API tests with transactional SQLite adapter; target MySQL smoke test is separate."""
import importlib
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

objModule = importlib.import_module('ordering.lifecycle.app')


class CursorAdapter:
    def __init__(self, objConnection):
        self.objConnection = objConnection

    def execute(self, strSql, arrParams=()):
        strSql = strSql.replace('%s', '?').replace(' FOR UPDATE', '')
        if 'ON DUPLICATE KEY' in strSql:
            strSql = strSql.split(' ON DUPLICATE KEY')[0].replace('INSERT INTO', 'INSERT OR IGNORE INTO')
        self.objCursor = self.objConnection.execute(strSql, arrParams)
        self.lastrowid = self.objCursor.lastrowid

    def fetchone(self):
        objRow = self.objCursor.fetchone()
        return dict(objRow) if objRow else None

    def fetchall(self):
        return [dict(objRow) for objRow in self.objCursor.fetchall()]


@pytest.fixture
def objHarness(monkeypatch):
    monkeypatch.setenv('SITE_URL', 'https://pizza.example')
    monkeypatch.setenv('ADMIN_USER', 'staff')
    monkeypatch.setenv('ADMIN_PASSWORD', 'test-password')
    monkeypatch.setenv('TAX_BASIS_POINTS', '825')
    objConnection = sqlite3.connect(':memory:', check_same_thread=False, detect_types=sqlite3.PARSE_DECLTYPES)
    objConnection.row_factory = sqlite3.Row
    objConnection.executescript('''
        PRAGMA foreign_keys=ON;
        CREATE TABLE customers(id INTEGER PRIMARY KEY,first_name TEXT,last_name TEXT,email TEXT UNIQUE,phone TEXT);
        CREATE TABLE orders(id INTEGER PRIMARY KEY,request_key TEXT UNIQUE,customer_id INTEGER REFERENCES customers(id),customer_name TEXT,customer_email TEXT,customer_phone TEXT,total_cents INTEGER,payment_method TEXT,tracking_token TEXT UNIQUE,tracking_status TEXT,payment_status TEXT,subtotal_cents INTEGER,tax_cents INTEGER,estimated_pickup_time timestamp,status TEXT DEFAULT 'received',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER REFERENCES orders(id),kind TEXT,description TEXT,quantity INTEGER,unit_price_cents INTEGER);
        CREATE TABLE order_events(id INTEGER PRIMARY KEY,order_id INTEGER REFERENCES orders(id),actor_email TEXT,event_type TEXT,from_status TEXT,to_status TEXT,details TEXT);
        CREATE TABLE menu_prices(category TEXT,name TEXT,price_cents INTEGER);
        INSERT INTO menu_prices VALUES('pizza','Small',1000),('topping','Cheese',150),('side','Breadsticks',500),('drink','Small',200);
    ''')
    @contextmanager
    def test_database():
        try:
            yield CursorAdapter(objConnection)
            objConnection.commit()
        except Exception:
            objConnection.rollback()
            raise
    arrMail = []
    monkeypatch.setattr(objModule, 'database', test_database)
    monkeypatch.setattr(objModule, 'dispatch_receipt', arrMail.append)
    with TestClient(objModule.app) as objClient:
        yield objClient, objConnection, arrMail
    objConnection.close()


def payload(strMethod='in_store'):
    return {'requestKey': str(uuid4()), 'customer': {'firstName': 'Ada', 'lastName': 'Lovelace', 'email': 'ada@example.com', 'phone': '5551234567'}, 'pizzas': [{'size': 'Small', 'toppings': ['Cheese']}], 'sides': [{'name': 'Breadsticks', 'quantity': 2}], 'drinks': [{'name': 'Water', 'size': 'Small', 'quantity': 1}], 'paymentMethod': strMethod, 'totalCents': 1}


def test_checkout_retry_receipt_tracker_and_mail(objHarness):
    objClient, objConnection, arrMail = objHarness
    objPayload = payload()
    objResponse = objClient.post('/api/orders', json=objPayload)
    assert objResponse.status_code == 201
    objReceipt = objResponse.json()
    assert (objReceipt['subtotalCents'], objReceipt['taxCents'], objReceipt['totalCents']) == (2350, 194, 2544)
    assert objReceipt['paymentStatus'] == 'unpaid'
    assert objReceipt['customer']['phone'] == '5551234567'
    assert len(objReceipt['trackerUrl'].split('token=')[1]) == 64
    assert objClient.post('/api/orders', json=objPayload).json() == objReceipt
    assert objConnection.execute('SELECT COUNT(*) FROM orders').fetchone()[0] == 1
    assert len(arrMail) == 1
    objTrack = objClient.get('/api/orders/' + objReceipt['trackerUrl'].split('token=')[1] + '/track')
    assert objTrack.status_code == 200
    assert objTrack.json()['status'] == 'order_received'
    assert objTrack.json()['estimatedPickupTime'] is None
    assert 'customer' not in objTrack.json() and 'email' not in objTrack.text
    assert objTrack.headers['cache-control'] == 'no-store'
    assert objClient.get('/api/orders/1/track').status_code == 404
    assert objClient.get('/api/orders/' + '0' * 64 + '/track').status_code == 404


def test_online_order_cannot_bypass_verified_stripe_fulfillment(objHarness):
    assert objHarness[0].post('/api/orders', json=payload('online')).status_code == 400
    assert objHarness[1].execute('SELECT COUNT(*) FROM orders').fetchone()[0] == 0


@pytest.mark.parametrize('strField,objValue', [('phone',''),('phone','-------'),('email','bad'),('firstName',' ')])
def test_invalid_contact_leaves_no_records(objHarness, strField, objValue):
    objPayload = payload()
    objPayload['customer'][strField] = objValue
    assert objHarness[0].post('/api/orders', json=objPayload).status_code == 422
    assert objHarness[1].execute('SELECT COUNT(*) FROM customers').fetchone()[0] == 0


def test_invalid_menu_and_failed_item_insert_roll_back(objHarness):
    objClient, objConnection, arrMail = objHarness
    objPayload = payload()
    objPayload['pizzas'][0]['toppings'] = ['Not a topping']
    assert objClient.post('/api/orders', json=objPayload).status_code == 422
    objConnection.execute("CREATE TRIGGER reject_item BEFORE INSERT ON order_items BEGIN SELECT RAISE(ABORT,'forced item failure'); END")
    with pytest.raises(sqlite3.IntegrityError):
        objClient.post('/api/orders', json=payload())
    for strTable in ('customers', 'orders', 'order_items', 'order_events'):
        assert objConnection.execute('SELECT COUNT(*) FROM ' + strTable).fetchone()[0] == 0
    assert not arrMail


def test_staff_auth_estimate_sequential_stale_and_archive(objHarness):
    objClient = objHarness[0]
    objReceipt = objClient.post('/api/orders', json=payload()).json()
    strBase = f"/api/employee/orders/{objReceipt['orderId']}"
    assert objClient.get('/api/employee/orders/active').status_code == 401
    assert objClient.patch(strBase + '/status', json={'status':'order_ready','expectedStatus':'order_received'}).status_code == 401
    objClient.auth = ('staff', 'test-password')
    objClient.headers['X-Luigi-Actor'] = 'owner@example.com'
    assert len(objClient.get('/api/employee/orders/active').json()) == 1
    assert objClient.post(strBase + '/complete', json={'expectedStatus':'order_ready'}).status_code == 409
    assert objClient.patch(strBase + '/status', json={'status':'order_ready','expectedStatus':'order_received'}).status_code == 409
    assert objClient.patch(strBase + '/estimate', json={'estimatedPickupTime':'2020-01-01T00:00:00Z'}).status_code == 422
    strEstimate = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    assert objClient.patch(strBase + '/estimate', json={'estimatedPickupTime':strEstimate}).status_code == 200
    for nIndex in range(4):
        objChange = {'expectedStatus':objModule.arrStages[nIndex], 'status':objModule.arrStages[nIndex+1]}
        assert objClient.patch(strBase + '/status', json=objChange).status_code == 200
        assert objClient.patch(strBase + '/status', json=objChange).status_code == 409
    assert len(objClient.get('/api/employee/orders/active').json()) == 1
    assert objClient.post(strBase + '/complete', json={'expectedStatus':'order_ready'}).status_code == 200
    assert objClient.get('/api/employee/orders/active').json() == []
    assert objHarness[1].execute("SELECT COUNT(*) FROM order_events WHERE actor_email='owner@example.com'").fetchone()[0] == 5
    assert objClient.patch(strBase + '/estimate', json={'estimatedPickupTime':strEstimate}).status_code == 409


def test_origin_and_unconfigured_mail_do_not_log_customer_details(objHarness, monkeypatch, caplog):
    assert objHarness[0].post('/api/orders', json=payload(), headers={'Origin':'https://evil.example'}).status_code == 403
    objReceipt = objHarness[0].post('/api/orders', json=payload()).json()
    from ordering.lifecycle.email_service import dispatch_receipt
    monkeypatch.delenv('SMTP_HOST', raising=False)
    dispatch_receipt(objReceipt)
    assert 'not configured' in caplog.text
    assert objReceipt['trackerUrl'] not in caplog.text
    assert objReceipt['customer']['email'] not in caplog.text
    assert objReceipt['customer']['phone'] not in caplog.text
    assert 'Subtotal: $23.50' not in caplog.text


def test_smtp_failure_does_not_log_customer_details(objHarness, monkeypatch, caplog):
    from ordering.lifecycle import email_service as objEmailService
    objReceipt = objHarness[0].post('/api/orders', json=payload()).json()
    monkeypatch.setenv('SMTP_HOST', 'smtp.example.invalid')
    monkeypatch.setenv('SMTP_FROM', 'receipts@example.invalid')
    def fail_smtp(*arrArgs, **objOptions):
        raise OSError('Provider error may contain private data; do not log it')
    monkeypatch.setattr(objEmailService.smtplib, 'SMTP', fail_smtp)
    objEmailService.dispatch_receipt(objReceipt)
    assert 'SMTP receipt delivery failed' in caplog.text
    for strPrivate in [objReceipt['customer']['email'], objReceipt['customer']['phone'], objReceipt['trackerUrl'], 'Provider error may contain private data']:
        assert strPrivate not in caplog.text


def test_checkout_retries_only_deadlock_victims(monkeypatch):
    from fastapi import BackgroundTasks
    import pymysql
    arrAttempts = []
    def attempt(objPayload, objTasks):
        arrAttempts.append(1)
        if len(arrAttempts) == 1:
            raise pymysql.OperationalError(1213, 'Deadlock test')
        return {'orderId': 12}
    monkeypatch.setattr(objModule, 'create_order_once', attempt)
    assert objModule.create_order(objModule.Checkout.model_validate(payload()), BackgroundTasks()) == {'orderId': 12}
    assert len(arrAttempts) == 2
    def unavailable(objPayload, objTasks):
        raise pymysql.OperationalError(2003, 'Connection test')
    monkeypatch.setattr(objModule, 'create_order_once', unavailable)
    with pytest.raises(pymysql.OperationalError):
        objModule.create_order(objModule.Checkout.model_validate(payload()), BackgroundTasks())
