"""Menu API integration checks with isolated transactional SQL and no live email."""
from contextlib import contextmanager

import pymysql
import pytest

from ordering.lifecycle.tests.test_lifecycle import objHarness, objModule, payload

objStaffAuth = ('staff', 'test-password')


@pytest.mark.parametrize('strMethod,strPath,objInput', [
    ('GET', '/api/admin/menu', None),
    ('POST', '/api/admin/menu', {'category': 'side', 'name': 'Knots', 'priceCents': 700}),
    ('PATCH', '/api/admin/menu/side/Breadsticks', {'name': 'Knots', 'priceCents': 700}),
    ('DELETE', '/api/admin/menu/side/Breadsticks', {'confirmation': 'DELETE Breadsticks'}),
])
def test_all_menu_routes_require_internal_credentials(objHarness, strMethod, strPath, objInput):
    objClient, objConnection, _ = objHarness
    for objAuth in [None, ('staff', 'wrong')]:
        objResponse = objClient.request(strMethod, strPath, json=objInput, auth=objAuth)
        assert objResponse.status_code == 401
    assert objConnection.execute('SELECT COUNT(*) FROM menu_prices').fetchone()[0] == 5
    assert objConnection.execute('SELECT SUM(is_active) FROM menu_prices').fetchone()[0] == 5


def test_admin_can_add_rename_edit_and_soft_delete_without_losing_history(objHarness):
    objClient, objConnection, _ = objHarness
    objPayload = payload()
    objReceipt = objClient.post('/api/orders', json=objPayload).json()
    arrHistory = objConnection.execute('SELECT * FROM order_items').fetchall()
    objResponse = objClient.post('/api/admin/menu', auth=objStaffAuth, json={
        'category': 'side', 'name': 'Garlic Knots', 'description': 'Fresh garlic', 'priceCents': 700})
    assert objResponse.status_code == 201
    assert objResponse.json()['is_active'] == 1
    objResponse = objClient.patch('/api/admin/menu/side/Garlic%20Knots', auth=objStaffAuth, json={
        'name': 'Garlic Bites', 'description': 'Roasted garlic', 'priceCents': 800})
    assert objResponse.status_code == 200
    assert objResponse.json()['description'] == 'Roasted garlic'
    assert objClient.patch('/api/admin/menu/side/Garlic%20Bites', auth=objStaffAuth, json={
        'name': 'Garlic Bites', 'priceCents': 800}).json()['description'] == 'Roasted garlic'
    objResponse = objClient.request('DELETE', '/api/admin/menu/side/Garlic%20Bites', auth=objStaffAuth,
                                    json={'confirmation': 'DELETE Garlic Bites'})
    assert objResponse.status_code == 200
    arrMenu = objClient.get('/api/admin/menu', auth=objStaffAuth).json()
    assert next(objRow for objRow in arrMenu if objRow['name'] == 'Garlic Bites')['is_active'] == 0
    assert objConnection.execute('SELECT COUNT(*) FROM menu_prices').fetchone()[0] == 6
    assert objConnection.execute('SELECT * FROM order_items').fetchall() == arrHistory
    assert objClient.post('/api/orders', json=objPayload).json() == objReceipt


@pytest.mark.parametrize('strConfirmation', [
    'DELETE [item name]', 'DELETE breadsticks', 'delete Breadsticks',
    'DELETE Breadsticks ', ' DELETE Breadsticks', 'Delete Breadsticks FOREVER', '',
])
def test_soft_delete_requires_exact_database_name(objHarness, strConfirmation):
    objClient, objConnection, _ = objHarness
    objResponse = objClient.request('DELETE', '/api/admin/menu/side/Breadsticks', auth=objStaffAuth,
                                    json={'confirmation': strConfirmation})
    assert objResponse.status_code == 422
    assert objConnection.execute("SELECT is_active FROM menu_prices WHERE name='Breadsticks'").fetchone()[0] == 1


def test_duplicates_inactive_targets_and_stale_names_are_rejected(objHarness):
    objClient, objConnection, _ = objHarness
    assert objClient.post('/api/admin/menu', auth=objStaffAuth, json={
        'category': 'side', 'name': 'Breadsticks', 'priceCents': 900}).status_code == 409
    objClient.post('/api/admin/menu', auth=objStaffAuth, json={
        'category': 'side', 'name': 'Knots', 'priceCents': 700})
    assert objClient.patch('/api/admin/menu/side/Knots', auth=objStaffAuth, json={
        'name': 'Breadsticks', 'priceCents': 800}).status_code == 409
    assert objConnection.execute("SELECT price_cents FROM menu_prices WHERE name='Knots'").fetchone()[0] == 700
    assert objClient.patch('/api/admin/menu/side/Knots', auth=objStaffAuth, json={
        'name': 'Garlic Knots', 'priceCents': 800}).status_code == 200
    assert objClient.request('DELETE', '/api/admin/menu/side/Knots', auth=objStaffAuth,
                             json={'confirmation': 'DELETE Knots'}).status_code == 404
    assert objClient.request('DELETE', '/api/admin/menu/side/Garlic%20Knots', auth=objStaffAuth,
                             json={'confirmation': 'DELETE Garlic Knots'}).status_code == 200
    assert objClient.request('DELETE', '/api/admin/menu/side/Garlic%20Knots', auth=objStaffAuth,
                             json={'confirmation': 'DELETE Garlic Knots'}).status_code == 404
    assert objClient.patch('/api/admin/menu/side/Garlic%20Knots', auth=objStaffAuth, json={
        'name': 'New Knots', 'priceCents': 800}).status_code == 404
    assert objClient.post('/api/admin/menu', auth=objStaffAuth, json={
        'category': 'side', 'name': 'Garlic Knots', 'priceCents': 800}).status_code == 409


@pytest.mark.parametrize('objChange', [
    {'category': 'unknown'}, {'name': 'Bad; DROP TABLE orders'}, {'name': 'x' * 61},
    {'description': 'x' * 1001}, {'description': 'bad\x00text'}, {'priceCents': -1},
    {'priceCents': 1000001}, {'priceCents': 12.5}, {'priceCents': True},
    {'priceCents': '700'}, {'priceCents': 0}, {'is_active': 0},
])
def test_menu_inputs_are_validated_without_writes(objHarness, objChange):
    objClient, objConnection, _ = objHarness
    objInput = {'category': 'side', 'name': 'Knots', 'description': '', 'priceCents': 700, **objChange}
    assert objClient.post('/api/admin/menu', auth=objStaffAuth, json=objInput).status_code == 422
    assert objConnection.execute('SELECT COUNT(*) FROM menu_prices').fetchone()[0] == 5


def test_new_and_renamed_choices_can_be_ordered_and_inactive_choices_cannot(objHarness):
    objClient, objConnection, _ = objHarness
    for strCategory, strName, nPrice in [('pizza', 'Family', 2500), ('topping', 'Mushrooms', 200),
                                       ('side', 'Knots', 700), ('drink', 'Jumbo', 400),
                                       ('drink_name', 'Lemon Soda', 0)]:
        assert objClient.post('/api/admin/menu', auth=objStaffAuth, json={
            'category': strCategory, 'name': strName, 'priceCents': nPrice}).status_code == 201
    assert objClient.patch('/api/admin/menu/side/Knots', auth=objStaffAuth, json={
        'name': 'Garlic Knots', 'priceCents': 750}).status_code == 200
    objPayload = payload()
    objPayload.update(pizzas=[{'size': 'Family', 'toppings': ['Mushrooms']}],
                      sides=[{'name': 'Garlic Knots', 'quantity': 1}],
                      drinks=[{'name': 'Lemon Soda', 'size': 'Jumbo', 'quantity': 1}])
    objResponse = objClient.post('/api/orders', json=objPayload)
    assert objResponse.status_code == 201
    assert objResponse.json()['subtotalCents'] == 3850
    assert objClient.request('DELETE', '/api/admin/menu/drink_name/Lemon%20Soda', auth=objStaffAuth,
                             json={'confirmation': 'DELETE Lemon Soda'}).status_code == 200
    objPayload['requestKey'] = payload()['requestKey']
    assert objClient.post('/api/orders', json=objPayload).status_code == 422
    assert objConnection.execute('SELECT COUNT(*) FROM orders').fetchone()[0] == 1


@pytest.mark.parametrize('strMethod,strPath,objInput', [
    ('POST', '/api/admin/menu', {'category': 'side', 'name': 'Knots', 'priceCents': 700}),
    ('PATCH', '/api/admin/menu/side/Breadsticks', {'name': 'Knots', 'priceCents': 700}),
    ('DELETE', '/api/admin/menu/side/Breadsticks', {'confirmation': 'DELETE Breadsticks'}),
])
def test_menu_mutation_rolls_back_on_database_failure(objHarness, monkeypatch, strMethod, strPath, objInput):
    objClient, objConnection, _ = objHarness
    fnDatabase = objModule.database

    @contextmanager
    def failed_database():
        with fnDatabase() as objCursor:
            yield objCursor
            raise pymysql.OperationalError(2013, 'injected failure')

    monkeypatch.setattr(objModule, 'database', failed_database)
    assert objClient.request(strMethod, strPath, auth=objStaffAuth, json=objInput).status_code == 503
    objRow = objConnection.execute("SELECT price_cents,is_active FROM menu_prices WHERE name='Breadsticks'").fetchone()
    assert tuple(objRow) == (500, 1)
    assert objConnection.execute("SELECT COUNT(*) FROM menu_prices WHERE name='Knots'").fetchone()[0] == 0


def test_delete_rejects_cross_origin_requests(objHarness):
    objClient, _, _ = objHarness
    assert objClient.request('DELETE', '/api/admin/menu/side/Breadsticks', auth=objStaffAuth,
                             headers={'Origin': 'https://other.example'},
                             json={'confirmation': 'DELETE Breadsticks'}).status_code == 403
