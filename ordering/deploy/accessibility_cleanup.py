"""Apply the reviewed accessibility cleanup without replacing unrelated live code.

Defaults to a read-only preflight. --apply backs up every changed file first.
"""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import re
import subprocess


def replace_once(strSource, strOld, strNew):
    if strSource.count(strOld) == 1:
        return strSource.replace(strOld, strNew, 1)
    if strOld not in strSource and strNew in strSource:
        return strSource
    raise ValueError('Expected exactly one matching code fragment: ' + strOld[:100])


def transform(strPath, strSource):
    if strPath == 'index.html':
        strSource = replace_once(strSource, 'border-color:#ddd5c8;min-height:47px',
                                 'border-color:#756d61;min-height:47px')
        strSource = replace_once(strSource, '.form-check-input{accent-color:',
                                 '.form-check-input{border-color:#756d61;accent-color:')
        strSource = replace_once(strSource, '<label class="side-quantity-label"><span>Qty</span>',
                                 '<label class="side-quantity-label"><span>Quantity</span>')
        strOld = 'let nextPizzaId=1,nextDrinkId=1, requestKey=null, submitting=false, stripe=null, stripeElements=null, cardNumberElement=null, cardExpiryElement=null, cardCvcElement=null, paymentFieldsReady=false;'
        if strOld in strSource:
            # Abort if the live version actually uses any retired Elements variable.
            strRemaining = strSource.replace(strOld, '')
            for strVariable in ['stripe', 'stripeElements', 'cardNumberElement', 'cardExpiryElement', 'cardCvcElement', 'paymentFieldsReady']:
                if re.search(r'(?<![\w-])' + strVariable + r'(?![\w-])', strRemaining):
                    raise ValueError('Live code still references ' + strVariable)
        strSource = replace_once(strSource, strOld,
                                 'let nextPizzaId=1,nextDrinkId=1, requestKey=null, submitting=false;')
        strSource = strSource.replace('// Stripe Elements collect payment fields in Stripe-hosted iframes; raw card data never reaches this app.',
                                       '// Card details are collected on Stripe-hosted Checkout.')
        for strClass in ['stripe-card-field', 'secure-note', 'disclaimer', 'drink-row', 'drink-sizes', 'drink-size']:
            # Only discard CSS when no remaining HTML/JS consumer uses the class.
            strCandidate = re.sub(r'\.' + strClass + r'(?: iframe|\.selected| small)?\{[^{}]*\}', '', strSource)
            if re.search(r'(?<![\w-])' + strClass + r'(?![\w-])', strCandidate):
                raise ValueError('Live code still references CSS class ' + strClass)
            strSource = strCandidate
    elif strPath == 'ordering/server.js':
        strOld = "import {normalizeEditableItems,validateOrder} from './validation.js';"
        if strOld in strSource and len(re.findall(r'\bvalidateOrder\b', strSource)) != 1:
            raise ValueError('Live server still uses validateOrder')
        strSource = replace_once(strSource, strOld,
                                 "import {normalizeEditableItems} from './validation.js';")
    elif strPath == 'ordering/public/staff.html':
        strSource = replace_once(strSource, 'border:1px solid #a99d8b', 'border:1px solid #756d61')
    elif strPath == 'ordering/public/tracker.html':
        strSource = replace_once(strSource, '<p id="tracker-estimate">',
                                 '<p id="tracker-estimate" role="status" aria-live="polite" aria-atomic="true">')
    elif strPath == 'ordering/public/tracker.js':
        strOld = "getTrackerElement('tracker-estimate').textContent=objOrder.estimatedPickupTime?`Estimated pickup: ${new Date(objOrder.estimatedPickupTime).toLocaleString()}`:'Awaiting kitchen confirmation…';"
        strNew = "const strEstimate=objOrder.estimatedPickupTime?`Estimated pickup: ${new Date(objOrder.estimatedPickupTime).toLocaleString()}`:'Awaiting kitchen confirmation…';\n  if(getTrackerElement('tracker-estimate').textContent!==strEstimate)getTrackerElement('tracker-estimate').textContent=strEstimate;"
        strSource = replace_once(strSource, strOld, strNew)
    elif strPath == 'ordering/public/admin.html':
        strSource = replace_once(strSource, 'input,textarea,select{border:1px solid #a9a193',
                                 'input,textarea,select{border:1px solid #756d61')
        for strId in ['current-orders', 'past-orders']:
            strSource = replace_once(strSource, f'id="{strId}" aria-live="polite"', f'id="{strId}"')
        if 'const mapOrderSnapshots=new Map();' not in strSource:
            strSource = replace_once(strSource, 'async function loadOrders(strBucket,bAutomatic=false) {',
                                     'const mapOrderSnapshots=new Map();\n    async function loadOrders(strBucket,bAutomatic=false) {')
            nStart = strSource.index('    async function loadOrders(')
            nEnd = strSource.index('    async function changeStatus(', nStart)
            strFunction = strSource[nStart:nEnd]
            strFunction = replace_once(strFunction, '        objContainer.replaceChildren();',
                                      '        const strSnapshot=JSON.stringify(arrOrders);\n        // Unchanged polling results must not rebuild controls or repeat announcements.\n        if(bAutomatic&&mapOrderSnapshots.get(strBucket)===strSnapshot)return true;\n        objContainer.replaceChildren();')
            strFunction = replace_once(strFunction, '        announce(`${arrOrders.length}',
                                      '        mapOrderSnapshots.set(strBucket,strSnapshot);\n        announce(`${arrOrders.length}')
            strSource = strSource[:nStart] + strFunction + strSource[nEnd:]
    return strSource


def main():
    objParser = argparse.ArgumentParser(description=__doc__)
    objParser.add_argument('--root', type=Path, default=Path('/opt/luigis'))
    objParser.add_argument('--apply', action='store_true')
    objArgs = objParser.parse_args()
    arrPaths = ['index.html', 'ordering/server.js', 'ordering/public/admin.html',
                'ordering/public/staff.html', 'ordering/public/tracker.html', 'ordering/public/tracker.js']
    arrChanges = []
    # Complete all matching checks before creating backups or changing a file.
    for strPath in arrPaths:
        objPath = objArgs.root / strPath
        bufBefore = objPath.read_bytes()
        strBefore = bufBefore.decode('utf-8')
        strAfter = transform(strPath, strBefore)
        if strAfter != strBefore:
            arrChanges.append((objPath, bufBefore, strAfter.encode('utf-8')))
            print('READY', strPath)
    if not objArgs.apply:
        print('READ ONLY:', len(arrChanges), 'files would change.')
        return
    strStamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    arrWritten = []
    try:
        for objPath, bufBefore, bufAfter in arrChanges:
            if objPath.read_bytes() != bufBefore:
                raise RuntimeError('File changed during preflight: ' + str(objPath))
            objBackup = objPath.with_name(objPath.name + '.bak-accessibility-' + strStamp)
            if objBackup.exists():
                raise FileExistsError(str(objBackup))
            subprocess.run(['cp', '--preserve=all', '--no-clobber', str(objPath), str(objBackup)], check=True)
            if objBackup.read_bytes() != bufBefore:
                raise RuntimeError('Backup verification failed: ' + str(objPath))
            print('BACKUP', objBackup)
        for objPath, bufBefore, bufAfter in arrChanges:
            if objPath.read_bytes() != bufBefore:
                raise RuntimeError('Concurrent file change: ' + str(objPath))
            arrWritten.append((objPath, bufBefore))
            # Write in place to preserve existing ownership and permission bits.
            objPath.write_bytes(bufAfter)
            if objPath.read_bytes() != bufAfter:
                raise RuntimeError('Write verification failed: ' + str(objPath))
            print('UPDATED', objPath)
    except Exception:
        for objPath, bufBefore in reversed(arrWritten):
            objPath.write_bytes(bufBefore)
        raise
    print('DONE. No services restarted; no database changes.')


if __name__ == '__main__':
    main()
