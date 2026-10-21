"""Explain invalid checkout fields without echoing contact details or input values."""


def checkout_validation_error(objError):
    objLabels = {
        'firstName': 'Enter your first name (up to 80 characters).',
        'lastName': 'Enter your last name (up to 80 characters).',
        'email': 'Enter a valid email address.',
        'phone': 'Enter a valid phone number, or leave it blank for guest checkout.',
        'pizzas': 'Check the pizza sizes and toppings; choose at least one pizza.',
        'sides': 'Check side selections and quantities.',
        'drinks': 'Check drink names, sizes and quantities.',
        'requestKey': 'The checkout reference is invalid. Refresh the page before retrying.',
        'paymentMethod': 'Choose an available payment method.',
    }
    arrMessages = []
    arrFields = []
    for objIssue in objError.errors():
        arrPath = list(objIssue.get('loc', ()))
        if arrPath and arrPath[0] == 'body':
            arrPath = arrPath[1:]
        strField = arrPath[1] if len(arrPath) > 1 and arrPath[0] == 'customer' else arrPath[0] if arrPath else ''
        if strField not in objLabels:
            continue
        strSafeField = 'customer.' + strField if arrPath[0] == 'customer' else strField
        if strSafeField not in arrFields:
            arrFields.append(strSafeField)
            arrMessages.append(objLabels[strField])
    return {'error': ' '.join(arrMessages) or 'Check the required order fields and try again.', 'fields': arrFields}
