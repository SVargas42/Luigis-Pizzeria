import pytest

from ordering.lifecycle.tests.test_lifecycle import objHarness, payload


@pytest.mark.parametrize('strSize,nUnit', [(None,500), ('Small',400), ('Medium',500), ('Large',600)])
def test_side_size_price_snapshot_and_retry(objHarness, strSize, nUnit):
    objClient, objConnection, arrMail = objHarness
    objPayload = payload()
    if strSize is not None:
        objPayload['sides'][0]['size'] = strSize
    objPayload['sides'][0]['unit_price_cents'] = 1
    objResponse = objClient.post('/api/orders', json=objPayload)
    assert objResponse.status_code == 201
    objReceipt = objResponse.json()
    strExpectedSize = strSize or 'Medium'
    objSide = next(objItem for objItem in objReceipt['items'] if objItem['kind'] == 'side')
    assert (objSide['size'], objSide['unit'], objSide['description']) == (
        strExpectedSize, nUnit, f'Breadsticks ({strExpectedSize})')
    assert objReceipt['subtotalCents'] == 1350 + nUnit * 2
    assert tuple(objConnection.execute("SELECT size,unit_price_cents FROM order_items WHERE kind='side'").fetchone()) == (strExpectedSize, nUnit)
    objConnection.execute('UPDATE menu_variations SET price_cents=999,is_active=0')
    objConnection.commit()
    assert objClient.post('/api/orders', json=objPayload).json() == objReceipt
    assert objConnection.execute('SELECT COUNT(*) FROM account_mail').fetchone()[0] == 1


@pytest.mark.parametrize('strSize', ['Regular', 'Tiny', 'Extra Large', '', 'x'*21])
def test_invalid_sizes_leave_no_order_records(objHarness, strSize):
    objClient, objConnection, _ = objHarness
    objPayload = payload();objPayload['sides'][0]['size'] = strSize
    assert objClient.post('/api/orders', json=objPayload).status_code == 422
    assert objConnection.execute('SELECT COUNT(*) FROM orders').fetchone()[0] == 0
    assert objConnection.execute('SELECT COUNT(*) FROM customers').fetchone()[0] == 0


def test_inactive_default_and_explicit_size_cannot_fall_back_to_base_price(objHarness):
    objClient, objConnection, _ = objHarness
    objConnection.execute("UPDATE menu_variations SET is_active=0 WHERE size='Medium'")
    objConnection.commit()
    assert objClient.post('/api/orders', json=payload()).status_code == 422
    objPayload = payload();objPayload['sides'][0]['size'] = 'Medium'
    assert objClient.post('/api/orders', json=objPayload).status_code == 422
    assert objConnection.execute('SELECT COUNT(*) FROM orders').fetchone()[0] == 0


def test_unsized_items_keep_regular_price_and_legacy_receipts_remain_readable(objHarness):
    objClient, objConnection, _ = objHarness
    objConnection.execute("INSERT INTO menu_prices(category,name,price_cents) VALUES('side','Pizza Bites',600)")
    objConnection.commit()
    objPayload = payload();objPayload['sides'] = [{'name':'Pizza Bites','quantity':1}]
    objResponse = objClient.post('/api/orders', json=objPayload)
    assert objResponse.status_code == 201
    objSide = next(objItem for objItem in objResponse.json()['items'] if objItem['kind'] == 'side')
    assert (objSide['size'], objSide['unit'], objSide['description']) == ('Regular',600,'Pizza Bites')
    objConnection.execute('UPDATE order_items SET size=NULL')
    objConnection.commit()
    assert all(objItem['size'] is None for objItem in objClient.post('/api/orders', json=objPayload).json()['items'])
    objPayload = payload();objPayload['sides'] = [{'name':'Pizza Bites','quantity':1,'size':'Large'}]
    assert objClient.post('/api/orders', json=objPayload).status_code == 422
