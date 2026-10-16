"""Replaceable receipt dispatcher; SMTP failure never changes a committed order."""
import logging
import os
import smtplib
from email.message import EmailMessage

objLogger = logging.getLogger("luigis.receipts")


def dispatch_receipt(objReceipt):
    strBody = '\n'.join([
        f"Receipt {objReceipt['orderNumber']}",
        f"{objReceipt['customer']['name']} | {objReceipt['customer']['phone']}",
        *[f"{objItem['quantity']} x {objItem['description']}: ${objItem['unit'] * objItem['quantity'] / 100:.2f}"
          for objItem in objReceipt['items']],
        f"Subtotal: ${objReceipt['subtotalCents'] / 100:.2f}",
        f"Tax: ${objReceipt['taxCents'] / 100:.2f}",
        f"Total: ${objReceipt['totalCents'] / 100:.2f}",
        f"Payment: {objReceipt['paymentMethod']} ({objReceipt['paymentStatus']})",
        f"Tracker: {objReceipt['trackerUrl']}",
    ])
    if os.getenv('SMTP_HOST'):
        try:
            objMessage = EmailMessage()
            objMessage['Subject'] = f"Luigi's receipt {objReceipt['orderNumber']}"
            objMessage['From'] = os.environ['SMTP_FROM']
            objMessage['To'] = objReceipt['customer']['email']
            objMessage.set_content(strBody)
            with smtplib.SMTP(os.environ['SMTP_HOST'], int(os.getenv('SMTP_PORT', '587')), timeout=10) as objSmtp:
                objSmtp.starttls()
                if os.getenv('SMTP_USER'):
                    objSmtp.login(os.environ['SMTP_USER'], os.environ['SMTP_PASSWORD'])
                objSmtp.send_message(objMessage)
            return
        except Exception:
            objLogger.warning('SMTP dispatch failed; receipt follows in local log')
    objLogger.warning('Receipt for %s\n%s', objReceipt['customer']['email'], strBody)
