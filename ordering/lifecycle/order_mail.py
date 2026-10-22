"""Queue transactional order mail; the Node worker owns SMTP delivery/retries."""
import os
from uuid import uuid4


def enqueue_message(objCursor, strRecipient, strSubject, strMessage):
    # Existing receipt-purpose mail is durable and does not expire like reset links.
    objCursor.execute(
        "INSERT INTO account_mail(id,recipient,subject,message,purpose) VALUES(%s,%s,%s,%s,'receipt')",
        (str(uuid4()), strRecipient, strSubject, strMessage),
    )


def enqueue_receipt(objCursor, objReceipt):
    strBody = '\n'.join([
        f"Order received: {objReceipt['orderNumber']}",
        *[f"{objItem['quantity']} x {objItem['description']}: ${objItem['unit'] * objItem['quantity'] / 100:.2f}"
          for objItem in objReceipt['items']],
        f"Subtotal: ${objReceipt['subtotalCents'] / 100:.2f}",
        f"Tax: ${objReceipt['taxCents'] / 100:.2f}",
        f"Total: ${objReceipt['totalCents'] / 100:.2f}",
        f"Payment: {objReceipt['paymentMethod']} ({objReceipt['paymentStatus']})",
        'Payment is due at pickup.' if objReceipt['paymentStatus'] == 'unpaid' else '',
        f"Track your order: {objReceipt['trackerUrl']}",
    ])
    enqueue_message(objCursor, objReceipt['customer']['email'],
                    f"Luigi order received {objReceipt['orderNumber']}", strBody)


def enqueue_progress(objCursor, objOrder, strStatus, strEstimate=None):
    # Keep intermediate progress, estimates and pickup completion on the tracker.
    # The receipt already confirms creation; only readiness needs another email.
    if strStatus != 'order_ready':
        return
    strLabel = 'Your order is ready for pickup!'
    strNumber = f"LP-{objOrder['id']}"
    strTracker = os.environ['SITE_URL'].rstrip('/') + '/track?token=' + objOrder['tracking_token']
    strBody = f"Order {strNumber}\n{strLabel}\n"
    if strEstimate:
        strBody += f"Estimated pickup time (UTC): {strEstimate}\n"
    strBody += f"Track your order: {strTracker}"
    enqueue_message(objCursor, objOrder['customer_email'], f"Luigi {strNumber}: {strLabel}", strBody)
