"""Employee routes require an independent, current staff session as well as proxy auth."""
import pytest

from ordering.lifecycle.tests.test_lifecycle import objHarness, payload


@pytest.mark.parametrize('strRole', ['customer', 'worker', 'admin'])
def test_employee_permissions_are_loaded_from_session_database(objHarness, strRole):
    objClient, objConnection, _ = objHarness
    objReceipt = objClient.post('/api/orders', json=payload()).json()
    objConnection.execute('UPDATE accounts SET role=? WHERE id=1', (strRole,))
    objConnection.commit()
    objClient.auth = ('staff', 'test-password')
    objClient.headers['X-Luigi-Role'] = 'admin'
    objResponse = objClient.patch(f"/api/employee/orders/{objReceipt['orderId']}/status",
        json={'expectedStatus': 'order_received', 'status': 'order_confirmed'})
    assert objResponse.status_code == (403 if strRole == 'customer' else 200)
    strStatus = objConnection.execute('SELECT tracking_status FROM orders').fetchone()[0]
    assert strStatus == ('order_received' if strRole == 'customer' else 'order_confirmed')


@pytest.mark.parametrize('strSession', ['missing', 'forged', 'expired', 'disabled', 'unverified'])
def test_invalid_staff_sessions_cannot_update_orders(objHarness, strSession):
    objClient, objConnection, _ = objHarness
    objReceipt = objClient.post('/api/orders', json=payload()).json()
    objClient.auth = ('staff', 'test-password')
    if strSession == 'missing':
        objClient.cookies.clear()
    elif strSession == 'forged':
        objClient.cookies.set('luigi_session', 'b'*64)
    elif strSession == 'expired':
        objConnection.execute("UPDATE account_sessions SET expires_at='2000-01-01'")
    elif strSession == 'disabled':
        objConnection.execute("UPDATE accounts SET disabled_at='2026-01-01'")
    else:
        objConnection.execute('UPDATE accounts SET email_verified_at=NULL')
    objConnection.commit()
    objResponse = objClient.patch(f"/api/employee/orders/{objReceipt['orderId']}/status",
        json={'expectedStatus': 'order_received', 'status': 'order_confirmed'})
    assert objResponse.status_code == 401
    assert objConnection.execute('SELECT tracking_status FROM orders').fetchone()[0] == 'order_received'


def test_customer_session_is_rejected_by_every_employee_endpoint(objHarness):
    objClient, objConnection, _ = objHarness
    objConnection.execute("UPDATE accounts SET role='customer'")
    objConnection.commit()
    objClient.auth = ('staff', 'test-password')
    for strMethod, strPath, objInput in [
        ('GET', '/api/employee/orders/active', None),
        ('PATCH', '/api/employee/orders/1/status', {'expectedStatus':'order_received', 'status':'order_confirmed'}),
        ('PATCH', '/api/employee/orders/1/estimate', {'estimatedPickupTime':'2099-01-01T00:00:00Z'}),
        ('POST', '/api/employee/orders/1/complete', {'expectedStatus':'order_ready'}),
    ]:
        assert objClient.request(strMethod, strPath, json=objInput).status_code == 403
    assert objConnection.execute('SELECT COUNT(*) FROM orders').fetchone()[0] == 0
