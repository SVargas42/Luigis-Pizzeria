"""Transactional lifecycle API sharing the existing Luigi's schema."""
import logging
import hashlib
import os
import re
import secrets
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

import pymysql
from fastapi import Header, BackgroundTasks, Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StringConstraints, field_validator

from .order_mail import enqueue_receipt, enqueue_progress
from .validation_messages import checkout_validation_error
from .menu_queries import (
    strActiveMenuQuery, strAdminMenuQuery, strInsertMenuQuery,
    strUpdateMenuQuery, strDeleteMenuQuery, strLockMenuQuery,
)

arrStages = ('order_received', 'order_confirmed', 'preparing_order', 'cooking_order', 'order_ready')
objSecurity = HTTPBasic()
app = FastAPI(title="Luigi's order lifecycle", docs_url=None, redoc_url=None)


class Customer(BaseModel):
    firstName: str = Field(min_length=1, max_length=80)
    lastName: str = Field(min_length=1, max_length=80)
    email: str = Field(max_length=254)
    phone: str = Field(default='', max_length=30)
    model_config = ConfigDict(str_strip_whitespace=True)

    @field_validator('email')
    @classmethod
    def email_valid(cls, strValue):
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', strValue):
            raise ValueError('Valid email required')
        return strValue.lower()

    @field_validator('phone')
    @classmethod
    def phone_valid(cls, strValue):
        if not strValue:
            return ''
        if not re.fullmatch(r'[0-9+() .-]+', strValue) or not 7 <= len(re.sub(r'\D', '', strValue)) <= 15:
            raise ValueError('Valid phone required')
        return strValue


class Pizza(BaseModel):
    size: str = Field(min_length=1, max_length=60)
    toppings: list[str] = Field(max_length=6)


class Side(BaseModel):
    size: str | None = Field(default=None, min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=60)
    quantity: StrictInt = Field(ge=1, le=99)


class Drink(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    size: str = Field(min_length=1, max_length=60)
    quantity: StrictInt = Field(ge=1, le=10)


class Checkout(BaseModel):
    requestKey: UUID
    customer: Customer
    pizzas: list[Pizza] = Field(min_length=1, max_length=20)
    sides: list[Side] = Field(max_length=20)
    drinks: list[Drink] = Field(max_length=20)
    paymentMethod: Literal['online', 'in_store']

    @field_validator('requestKey')
    @classmethod
    def retry_key_valid(cls, objValue):
        if objValue.version != 4:
            raise ValueError('UUID v4 required')
        return objValue


class StatusChange(BaseModel):
    status: str
    expectedStatus: str


class Completion(BaseModel):
    expectedStatus: Literal['order_ready']


class Estimate(BaseModel):
    estimatedPickupTime: datetime

    @field_validator('estimatedPickupTime')
    @classmethod
    def estimate_valid(cls, dtValue):
        if dtValue.tzinfo is None or dtValue <= datetime.now(timezone.utc):
            raise ValueError('Supply a future pickup time with timezone')
        return dtValue.astimezone(timezone.utc).replace(tzinfo=None)


MenuCategory = Annotated[str, StringConstraints(min_length=1, max_length=20,
                                              pattern=r'^[a-z][a-z0-9_]{0,19}$')]


class MenuChange(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    description: str = Field(default='', max_length=1000)
    priceCents: StrictInt = Field(ge=0, le=1000000)
    model_config = ConfigDict(extra='forbid')

    @field_validator('name')
    @classmethod
    def menu_name_valid(cls, strValue):
        strName = strValue.strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 '&-]{0,59}", strName):
            raise ValueError('Enter a valid menu item name')
        return strName

    @field_validator('description')
    @classmethod
    def menu_description_valid(cls, strValue):
        if any(ord(strChar) < 32 and strChar not in '\n\t' for strChar in strValue):
            raise ValueError('Description contains unsupported control characters')
        return strValue.strip()


class MenuCreate(MenuChange):
    category: MenuCategory


class MenuDelete(BaseModel):
    confirmation: str = Field(max_length=100)
    model_config = ConfigDict(extra='forbid')


def require_staff(objCredentials: HTTPBasicCredentials = Depends(objSecurity)):
    strUser, strPassword = os.getenv('ADMIN_USER', ''), os.getenv('ADMIN_PASSWORD', '')
    if not strUser or not strPassword or not (
        secrets.compare_digest(objCredentials.username.encode(), strUser.encode()) and
        secrets.compare_digest(objCredentials.password.encode(), strPassword.encode())
    ):
        raise HTTPException(401, 'Staff credentials required', headers={'WWW-Authenticate': 'Basic'})


def require_employee(objRequest: Request, objInternalAuth=Depends(require_staff)):
    # The internal credential authenticates the proxy; the session identifies its user.
    strToken = objRequest.cookies.get('luigi_session', '')
    if not re.fullmatch(r'[a-f0-9]{64}', strToken):
        raise HTTPException(401, 'A valid staff session is required')
    with database() as objCursor:
        objCursor.execute('''SELECT a.role FROM account_sessions s
            JOIN accounts a ON a.id=s.account_id
            WHERE s.token_hash=%s AND s.expires_at>UTC_TIMESTAMP()
            AND a.disabled_at IS NULL AND a.email_verified_at IS NOT NULL''',
            (hashlib.sha256(strToken.encode()).hexdigest(),))
        objAccount = objCursor.fetchone()
    if not objAccount:
        raise HTTPException(401, 'A valid staff session is required')
    if objAccount['role'] not in ('admin', 'worker'):
        raise HTTPException(403, 'A worker or administrator account is required')


@app.middleware('http')
async def protect_request(objRequest: Request, fnNext):
    strOrigin = objRequest.headers.get('origin')
    if objRequest.method in ('POST', 'PATCH', 'DELETE') and strOrigin and strOrigin.rstrip('/') != os.getenv('SITE_URL', '').rstrip('/'):
        return JSONResponse({'error': 'Invalid request origin'}, status_code=403)
    objResponse = await fnNext(objRequest)
    objResponse.headers['Cache-Control'] = 'no-store'
    objResponse.headers['Referrer-Policy'] = 'no-referrer'
    objResponse.headers['X-Content-Type-Options'] = 'nosniff'
    return objResponse


@app.exception_handler(HTTPException)
async def http_error(objRequest, objError):
    return JSONResponse({'error': objError.detail}, status_code=objError.status_code, headers=objError.headers)


@app.exception_handler(RequestValidationError)
async def validation_error(objRequest, objError):
    if objRequest.url.path.startswith('/api/admin/menu'):
        return JSONResponse({'error': 'Check the menu type, name, description, whole-cent price and confirmation.'}, status_code=422)
    return JSONResponse(checkout_validation_error(objError), status_code=422)


@app.exception_handler(pymysql.MySQLError)
async def database_error(objRequest, objError):
    logging.getLogger(__name__).error('Database operation failed (%s)', type(objError).__name__)
    if objRequest.url.path.startswith('/api/admin/menu'):
        return JSONResponse({'error': 'Menu service unavailable. Refresh the menu before retrying.'}, status_code=503)
    return JSONResponse({'error': 'Ordering service unavailable. Retry with the same request key.'}, status_code=503)


@contextmanager
def database():
    objConnection = pymysql.connect(
        host=os.getenv('DB_HOST', '127.0.0.1'), port=int(os.getenv('DB_PORT', '3306')),
        user=os.getenv('DB_USER', 'luigis_app'), password=os.environ['DB_PASSWORD'],
        database=os.getenv('DB_NAME', 'luigis'), charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor, autocommit=False,
        connect_timeout=5, read_timeout=10, write_timeout=10,
    )
    try:
        with objConnection.cursor() as objCursor:
            objCursor.execute("SET time_zone = '+00:00'")
            yield objCursor
        objConnection.commit()
    except Exception:
        objConnection.rollback()
        raise
    finally:
        objConnection.close()


@contextmanager
def menu_database():
    try:
        with database() as objCursor:
            yield objCursor
    except pymysql.IntegrityError as objError:
        if objError.args[0] == 1062:
            raise HTTPException(409, 'That menu name is already reserved in this category, including removed items.') from objError
        raise


def validate_menu_price(strCategory, nPrice):
    if nPrice == 0 and strCategory != 'drink_name':
        raise HTTPException(422, 'Only drink names may have a zero price adjustment.')


def lock_menu_item(objCursor, strCategory, strName):
    objCursor.execute(strLockMenuQuery, (strCategory, strName))
    objItem = objCursor.fetchone()
    if not objItem:
        raise HTTPException(404, 'Active menu item not found. Refresh the menu.')
    return objItem


@app.get('/api/admin/menu', dependencies=[Depends(require_staff)])
def list_menu_items():
    with menu_database() as objCursor:
        objCursor.execute(strAdminMenuQuery)
        return objCursor.fetchall()


@app.post('/api/admin/menu', status_code=201, dependencies=[Depends(require_staff)])
def add_menu_item(objInput: MenuCreate):
    validate_menu_price(objInput.category, objInput.priceCents)
    with menu_database() as objCursor:
        objCursor.execute(strInsertMenuQuery, (objInput.category, objInput.name,
                          objInput.description, objInput.priceCents))
    return {'category': objInput.category, 'name': objInput.name,
            'description': objInput.description, 'price_cents': objInput.priceCents, 'is_active': 1}


@app.patch('/api/admin/menu/{strCategory}/{strName}', dependencies=[Depends(require_staff)])
def edit_menu_item(strCategory: MenuCategory, strName: str, objInput: MenuChange):
    validate_menu_price(strCategory, objInput.priceCents)
    with menu_database() as objCursor:
        objItem = lock_menu_item(objCursor, strCategory, strName)
        # Older dashboard clients omit description; preserve the existing text.
        strDescription = objInput.description if 'description' in objInput.model_fields_set else objItem['description']
        objCursor.execute(strUpdateMenuQuery, (objInput.name, strDescription,
                          objInput.priceCents, strCategory, objItem['name']))
    return {'category': strCategory, 'name': objInput.name,
            'description': strDescription, 'price_cents': objInput.priceCents, 'is_active': 1}


@app.delete('/api/admin/menu/{strCategory}/{strName}', dependencies=[Depends(require_staff)])
def remove_menu_item(strCategory: MenuCategory, strName: str, objInput: MenuDelete):
    with menu_database() as objCursor:
        objItem = lock_menu_item(objCursor, strCategory, strName)
        # Compare with the locked database name, not the client's spelling or casing.
        if objInput.confirmation != 'DELETE ' + objItem['name']:
            raise HTTPException(422, 'Type DELETE followed by a space and the exact item name.')
        objCursor.execute(strDeleteMenuQuery, (strCategory, objItem['name']))
    return {'category': strCategory, 'name': objItem['name'], 'is_active': 0}


def price_side(objCursor, objSide, nBasePrice):
    objCursor.execute(
        "SELECT size FROM menu_variations WHERE category='side' AND name=%s",
        (objSide.name,),
    )
    arrSizes = [objRow['size'] for objRow in objCursor.fetchall()]
    strSize = objSide.size or ('Medium' if 'Medium' in arrSizes else 'Regular')
    nUnit = nBasePrice
    if arrSizes:
        objCursor.execute(
            """SELECT price_cents FROM menu_variations
               WHERE category='side' AND name=%s AND size=%s AND is_active=1""",
            (objSide.name, strSize),
        )
        objVariation = objCursor.fetchone()
        if not objVariation:
            raise HTTPException(422, 'Selected size is unavailable')
        nUnit = objVariation['price_cents']
        if type(nUnit) is not int or not 0 < nUnit <= 1000000:
            raise HTTPException(422, 'Invalid size price')
    elif strSize != 'Regular':
        raise HTTPException(422, 'This item has no size options')
    return {
        'kind': 'side',
        'description': f'{objSide.name} ({strSize})' if arrSizes else objSide.name,
        'size': strSize, 'quantity': objSide.quantity, 'unit': nUnit,
    }


def price_items(objPayload, arrMenu, objCursor):
    mapPrices = {(objRow['category'], objRow['name']): objRow['price_cents'] for objRow in arrMenu}
    def menu_price(strKind, strName):
        nPrice = mapPrices.get((strKind, strName))
        if type(nPrice) is not int or not 0 <= nPrice <= 1000000:
            raise HTTPException(422, 'Menu selection unavailable')
        return nPrice
    arrItems = []
    for objPizza in objPayload.pizzas:
        if len(set(objPizza.toppings)) != len(objPizza.toppings):
            raise HTTPException(422, 'Choose unique toppings')
        nUnit = menu_price('pizza', objPizza.size) + sum(menu_price('topping', strName) for strName in objPizza.toppings)
        arrItems.append({'kind': 'pizza', 'description': objPizza.size + ' pizza' + (' with ' + ', '.join(objPizza.toppings) if objPizza.toppings else ''), 'quantity': 1, 'unit': nUnit})
    for objSide in objPayload.sides:
        arrItems.append(price_side(objCursor, objSide, menu_price('side', objSide.name)))
    for objDrink in objPayload.drinks:
        arrItems.append({'kind': 'drink', 'description': f'{objDrink.name} ({objDrink.size})', 'quantity': objDrink.quantity, 'unit': menu_price('drink', objDrink.size) + menu_price('drink_name', objDrink.name)})
    return arrItems


def receipt(objCursor, objOrder):
    objCursor.execute('SELECT kind,description,size,quantity,unit_price_cents AS unit FROM order_items WHERE order_id=%s ORDER BY id', (objOrder['id'],))
    return {
        'orderNumber': f"LP-{objOrder['id']}", 'orderId': objOrder['id'],
        'customer': {'name': objOrder['customer_name'], 'email': objOrder['customer_email'], 'phone': objOrder['customer_phone']},
        'items': objCursor.fetchall(), 'subtotalCents': objOrder['subtotal_cents'],
        'taxCents': objOrder['tax_cents'], 'totalCents': objOrder['total_cents'],
        'paymentMethod': objOrder['payment_method'], 'paymentStatus': objOrder['payment_status'],
        'trackerUrl': os.environ['SITE_URL'].rstrip('/') + '/track?token=' + objOrder['tracking_token'],
    }


def create_order_once(objPayload: Checkout, objTasks: BackgroundTasks):
    # A unique retry key claims an order; all contact/item writes share its transaction.
    try:
        with database() as objCursor:
            objCursor.execute('SELECT * FROM orders WHERE request_key=%s', (str(objPayload.requestKey),))
            objExisting = objCursor.fetchone()
            if objExisting:
                if not objExisting['tracking_token']:
                    raise HTTPException(409, 'Retry key belongs to a legacy checkout')
                return receipt(objCursor, objExisting)
            objCursor.execute(strActiveMenuQuery)
            arrItems = price_items(objPayload, objCursor.fetchall(), objCursor)
            nSubtotal = sum(objItem['unit'] * objItem['quantity'] for objItem in arrItems)
            nRate = int(os.getenv('TAX_BASIS_POINTS', '0'))
            if not 0 <= nRate <= 10000:
                raise HTTPException(503, 'Tax configuration invalid')
            nTax = (nSubtotal * nRate + 5000) // 10000
            objCustomer = objPayload.customer
            objCursor.execute('INSERT INTO customers(first_name,last_name,email,phone) VALUES(%s,%s,%s,%s) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)', (objCustomer.firstName, objCustomer.lastName, objCustomer.email, objCustomer.phone))
            nCustomerId = objCursor.lastrowid
            objCursor.execute("INSERT INTO orders(request_key,customer_id,customer_name,customer_email,customer_phone,total_cents,payment_method,tracking_token,tracking_status,payment_status,subtotal_cents,tax_cents) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,'order_received',%s,%s,%s)",
                              (str(objPayload.requestKey), nCustomerId, f'{objCustomer.firstName} {objCustomer.lastName}', objCustomer.email, objCustomer.phone, nSubtotal + nTax, objPayload.paymentMethod, secrets.token_hex(32), 'pending' if objPayload.paymentMethod == 'online' else 'unpaid', nSubtotal, nTax))
            nOrderId = objCursor.lastrowid
            for objItem in arrItems:
                objCursor.execute('INSERT INTO order_items(order_id,kind,description,quantity,unit_price_cents,size) VALUES(%s,%s,%s,%s,%s,%s)', (nOrderId, objItem['kind'], objItem['description'], objItem['quantity'], objItem['unit'], objItem.get('size')))
            objCursor.execute("INSERT INTO order_events(order_id,event_type,to_status,details) VALUES(%s,'created','received','Lifecycle order_received')", (nOrderId,))
            objCursor.execute('SELECT * FROM orders WHERE id=%s', (nOrderId,))
            objReceipt = receipt(objCursor, objCursor.fetchone())
            enqueue_receipt(objCursor, objReceipt)
    except pymysql.IntegrityError as objError:
        if objError.args[0] != 1062:
            raise
        # Concurrent retries wait on the unique key, then read the winning commit.
        with database() as objCursor:
            objCursor.execute('SELECT * FROM orders WHERE request_key=%s', (str(objPayload.requestKey),))
            objExisting = objCursor.fetchone()
            if not objExisting or not objExisting['tracking_token']:
                raise HTTPException(409, 'Retry key conflict') from objError
            return receipt(objCursor, objExisting)
    return objReceipt


@app.get('/api/orders/{strToken}/track')
def track_order(strToken: str):
    if not re.fullmatch('[0-9a-f]{64}', strToken):
        raise HTTPException(404, 'Order not found')
    with database() as objCursor:
        objCursor.execute('SELECT id,tracking_status,estimated_pickup_time,status FROM orders WHERE tracking_token=%s', (strToken,))
        objOrder = objCursor.fetchone()
    if not objOrder:
        raise HTTPException(404, 'Order not found')
    dtEstimate = objOrder['estimated_pickup_time']
    return {'orderNumber': f"LP-{objOrder['id']}", 'status': objOrder['tracking_status'], 'completed': objOrder['status'] == 'completed', 'cancelled': objOrder['status'] == 'cancelled', 'estimatedPickupTime': dtEstimate.isoformat() + 'Z' if dtEstimate else None}


@app.get('/api/employee/orders/active', dependencies=[Depends(require_employee)])
def active_orders():
    with database() as objCursor:
        objCursor.execute("SELECT id,customer_name,customer_email,customer_phone,status,tracking_status,payment_method,payment_status,total_cents,estimated_pickup_time,created_at,updated_at FROM orders WHERE status NOT IN ('completed','cancelled') ORDER BY id DESC LIMIT 500")
        arrOrders = objCursor.fetchall()
        for objOrder in arrOrders:
            objCursor.execute('SELECT kind,description,quantity,unit_price_cents FROM order_items WHERE order_id=%s ORDER BY id', (objOrder['id'],))
            objOrder['items'] = objCursor.fetchall()
            if objOrder['estimated_pickup_time']:
                objOrder['estimated_pickup_time'] = objOrder['estimated_pickup_time'].isoformat() + 'Z'
            for strField in ('created_at', 'updated_at'):
                dtValue = objOrder[strField]
                if isinstance(dtValue, datetime):
                    objOrder[strField] = dtValue.isoformat() + 'Z'
            dtCreated = datetime.fromisoformat(objOrder['created_at'].replace('Z', '+00:00'))
            if dtCreated.tzinfo is None:
                dtCreated = dtCreated.replace(tzinfo=timezone.utc)
            objOrder['needsAttention'] = (datetime.now(timezone.utc) - dtCreated).total_seconds() >= 2700
        return arrOrders


def lock_order(objCursor, nOrderId):
    objCursor.execute('SELECT * FROM orders WHERE id=%s FOR UPDATE', (nOrderId,))
    objOrder = objCursor.fetchone()
    if not objOrder:
        raise HTTPException(404, 'Order not found')
    if not objOrder['tracking_status'] or objOrder['status'] in ('completed', 'cancelled'):
        raise HTTPException(409, 'Order is closed or uses legacy controls')
    return objOrder


@app.patch('/api/employee/orders/{nOrderId}/status', dependencies=[Depends(require_employee)])
def advance_status(nOrderId: int, objChange: StatusChange, x_luigi_actor: str = Header(default="staff")):
    with database() as objCursor:
        objOrder = lock_order(objCursor, nOrderId)
        nIndex = arrStages.index(objOrder['tracking_status'])
        if objChange.expectedStatus != objOrder['tracking_status'] or nIndex == 4 or objChange.status != arrStages[nIndex + 1]:
            raise HTTPException(409, 'Order changed or transition is not sequential; refresh queue')
        strLegacy = 'ready' if nIndex == 3 else 'preparing' if nIndex >= 1 else 'received'
        objCursor.execute('UPDATE orders SET tracking_status=%s,status=%s WHERE id=%s', (objChange.status, strLegacy, nOrderId))
        objCursor.execute("INSERT INTO order_events(order_id,actor_email,event_type,from_status,to_status,details) VALUES(%s,%s,'status_changed',%s,%s,%s)", (nOrderId, x_luigi_actor[:254], objOrder['status'], strLegacy, objChange.status))
        enqueue_progress(objCursor, objOrder, objChange.status)
    return {'status': objChange.status}


@app.patch('/api/employee/orders/{nOrderId}/estimate', dependencies=[Depends(require_employee)])
def set_estimate(nOrderId: int, objEstimate: Estimate):
    with database() as objCursor:
        objOrder = lock_order(objCursor, nOrderId)
        if objOrder['estimated_pickup_time'] != objEstimate.estimatedPickupTime:
            objCursor.execute('UPDATE orders SET estimated_pickup_time=%s WHERE id=%s', (objEstimate.estimatedPickupTime, nOrderId))
            enqueue_progress(objCursor, objOrder, 'estimate', objEstimate.estimatedPickupTime.isoformat() + 'Z')
    return {'estimatedPickupTime': objEstimate.estimatedPickupTime.isoformat() + 'Z'}


@app.post('/api/employee/orders/{nOrderId}/complete', dependencies=[Depends(require_employee)])
def complete_order(nOrderId: int, objCompletion: Completion, x_luigi_actor: str = Header(default="staff")):
    with database() as objCursor:
        objOrder = lock_order(objCursor, nOrderId)
        if objOrder['tracking_status'] != objCompletion.expectedStatus:
            raise HTTPException(409, 'Only ready orders can be archived')
        objCursor.execute("UPDATE orders SET status='completed' WHERE id=%s", (nOrderId,))
        objCursor.execute("INSERT INTO order_events(order_id,actor_email,event_type,from_status,to_status,details) VALUES(%s,%s,'status_changed','ready','completed','Picked up and archived')", (nOrderId, x_luigi_actor[:254]))
        enqueue_progress(objCursor, objOrder, 'completed')
    return {'status': 'completed'}


@app.post('/api/orders', status_code=201)
def create_order(objPayload: Checkout, objTasks: BackgroundTasks):
    if objPayload.paymentMethod != 'in_store':
        raise HTTPException(400, 'Online orders must be created by verified Stripe fulfillment')
    # InnoDB may choose either concurrent checkout as a deadlock victim. Its
    # transaction has already rolled back; retry the same key against the winner.
    for nAttempt in range(3):
        try:
            return create_order_once(objPayload, objTasks)
        except pymysql.OperationalError as objError:
            if objError.args[0] != 1213 or nAttempt == 2:
                raise
