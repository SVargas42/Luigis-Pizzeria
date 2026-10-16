"""Run the authorized lifecycle checks against an isolated MariaDB or the live URL.

Run as root through lifecycle_deploy.py; never prints credentials or tracking tokens.
The live mode creates one clearly labeled pickup test order, then archives it.
"""
import argparse
import importlib
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import httpx
import pymysql
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
objModule = importlib.import_module('ordering.lifecycle.app')


def verify_flow(objClient, strMethod='in_store'):
    strMarker = str(uuid4())
    objPayload = {
        'requestKey': strMarker,
        'customer': {'firstName': 'DEPLOYMENT TEST', 'lastName': 'DO NOT PREPARE',
                     'email': f'deployment-{strMarker}@example.invalid', 'phone': '2025550100'},
        'pizzas': [{'size': 'Small', 'toppings': []}], 'sides': [], 'drinks': [],
        'paymentMethod': strMethod, 'totalCents': 1,
    }
    objResponse = objClient.post('/api/orders', json=objPayload)
    assert objResponse.status_code == 201, f'Create returned {objResponse.status_code}'
    objReceipt = objResponse.json()
    assert objReceipt['customer']['email'] == objPayload['customer']['email']
    assert objReceipt['paymentStatus'] == ('unpaid' if strMethod == 'in_store' else 'pending')
    nSubtotal = sum(objItem['unit'] * objItem['quantity'] for objItem in objReceipt['items'])
    assert objReceipt['subtotalCents'] == nSubtotal
    assert objReceipt['taxCents'] == (nSubtotal * int(os.environ['TAX_BASIS_POINTS']) + 5000) // 10000
    assert objReceipt['totalCents'] == nSubtotal + objReceipt['taxCents']
    assert objClient.post('/api/orders', json=objPayload).json() == objReceipt
    strToken = objReceipt['trackerUrl'].split('token=')[1]
    assert len(strToken) == 64
    strTrack = f'/api/orders/{strToken}/track'
    objTrack = objClient.get(strTrack).json()
    assert objTrack['status'] == 'order_received' and objTrack['estimatedPickupTime'] is None
    assert 'customer_email' not in objTrack and 'customer' not in objTrack
    assert objClient.get('/api/employee/orders/active').status_code == 401
    objAuth = httpx.BasicAuth(os.environ['ADMIN_USER'], os.environ['ADMIN_PASSWORD'])
    strBase = f"/api/employee/orders/{objReceipt['orderId']}"
    assert any(objOrder['id'] == objReceipt['orderId'] for objOrder in objClient.get('/api/employee/orders/active', auth=objAuth).json())
    assert objClient.post(strBase + '/complete', json={'expectedStatus': 'order_ready'}, auth=objAuth).status_code == 409
    strEstimate = (datetime.now(timezone.utc) + timedelta(minutes=30)).replace(microsecond=0).isoformat()
    assert objClient.patch(strBase + '/estimate', json={'estimatedPickupTime': strEstimate}, auth=objAuth).status_code == 200
    assert objClient.get(strTrack).json()['estimatedPickupTime']
    for nIndex in range(4):
        objChange = {'expectedStatus': objModule.arrStages[nIndex], 'status': objModule.arrStages[nIndex + 1]}
        assert objClient.patch(strBase + '/status', json=objChange, auth=objAuth).status_code == 200
        assert objClient.patch(strBase + '/status', json=objChange, auth=objAuth).status_code == 409
        assert objClient.get(strTrack).json()['status'] == objChange['status']
    assert objClient.post(strBase + '/complete', json={'expectedStatus': 'order_ready'}, auth=objAuth).status_code == 200
    assert objClient.get(strTrack).json()['completed'] is True
    assert all(objOrder['id'] != objReceipt['orderId'] for objOrder in objClient.get('/api/employee/orders/active', auth=objAuth).json())
    print(f"PASS {strMethod}: {objReceipt['orderNumber']} receipt, tax, retry, tracker, estimate, five stages, stale rejection and archive", flush=True)
    return objPayload


def main():
    objParser = argparse.ArgumentParser()
    objParser.add_argument('--database')
    objParser.add_argument('--live', action='store_true')
    objArgs = objParser.parse_args()
    if objArgs.live:
        with httpx.Client(base_url=os.environ['SITE_URL'], headers={'Origin': os.environ['SITE_URL']}, timeout=20, trust_env=False) as objClient:
            assert objClient.get('/').status_code == 200
            assert objClient.get('/track').status_code == 200
            assert objClient.get('/api/menu').status_code == 200
            verify_flow(objClient)
        return
    assert objArgs.database and objArgs.database.startswith('luigis_lifecycle_check_')
    fnOriginalConnect = pymysql.connect

    def test_connect(**objOptions):
        # Exercise the production transaction context and SQL against the restored
        # MariaDB database, using root's existing Unix socket authentication only.
        return fnOriginalConnect(unix_socket='/run/mysqld/mysqld.sock', user='root',
                                 database=objArgs.database, charset='utf8mb4',
                                 cursorclass=pymysql.cursors.DictCursor, autocommit=False)

    with patch.object(pymysql, 'connect', test_connect), patch.object(objModule, 'dispatch_receipt') as objMail:
        with TestClient(objModule.app) as objClient:
            objPayload = verify_flow(objClient)
            verify_flow(objClient, 'online')
            assert objMail.call_count == 2
            objPayload['requestKey'] = str(uuid4())
            objPayload['customer']['email'] = f"concurrent-{uuid4()}@example.invalid"
            with ThreadPoolExecutor(max_workers=2) as objPool:
                arrResponses = list(objPool.map(lambda nIndex: objClient.post('/api/orders', json=objPayload), range(2)))
            assert all(objResponse.status_code == 201 for objResponse in arrResponses)
            assert arrResponses[0].json()['orderId'] == arrResponses[1].json()['orderId']
            print('PASS MariaDB concurrent retry creates one order', flush=True)
            objPayload['requestKey'] = str(uuid4())
            objPayload['customer']['email'] = f"rollback-{uuid4()}@example.invalid"
            fnOriginalExecute = pymysql.cursors.Cursor.execute

            def fail_item(objCursor, strQuery, arrParams=None):
                if strQuery.startswith('INSERT INTO order_items'):
                    raise pymysql.OperationalError(1213, 'Injected test failure')
                return fnOriginalExecute(objCursor, strQuery, arrParams)

            with patch.object(pymysql.cursors.Cursor, 'execute', fail_item):
                assert objClient.post('/api/orders', json=objPayload).status_code == 503
            with objModule.database() as objCursor:
                objCursor.execute('SELECT COUNT(*) AS count FROM orders WHERE request_key=%s', (objPayload['requestKey'],))
                assert objCursor.fetchone()['count'] == 0
                objCursor.execute('SELECT COUNT(*) AS count FROM customers WHERE email=%s', (objPayload['customer']['email'],))
                assert objCursor.fetchone()['count'] == 0
            print('PASS MariaDB failure rolls back order, contact and items', flush=True)


if __name__ == '__main__':
    main()
