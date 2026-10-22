"""Configure sandbox credentials privately without enabling checkout or charging a card."""
import getpass
import json
import os
from pathlib import Path
import re
import sys


def sandbox_settings(strKey, strWebhook):
    if not re.fullmatch(r'sk_test_[A-Za-z0-9]+', strKey):
        raise ValueError('Use a sandbox secret API key beginning sk_test_; live and publishable keys are rejected.')
    if not re.fullmatch(r'whsec_[A-Za-z0-9]+', strWebhook):
        raise ValueError('Use the signing secret for the sandbox webhook endpoint, beginning whsec_.')
    return {'STRIPE_MODE': 'test', 'STRIPE_ENABLED': '0', 'STRIPE_SECRET_KEY': strKey, 'STRIPE_WEBHOOK_SECRET': strWebhook}


def merge_settings(strContents, objValues):
    for strKey, strValue in objValues.items():
        objPattern = re.compile(r'^[ \t]*(?:export[ \t]+)?' + re.escape(strKey) + r'=.*$', re.MULTILINE)
        strLine = strKey + '=' + json.dumps(strValue)
        strContents = objPattern.sub(lambda objMatch: strLine, strContents) if objPattern.search(strContents) else strContents + '\n' + strLine + '\n'
    return strContents


def main():
    if not sys.stdin.isatty():
        raise ValueError('Run in an interactive SSH terminal; keys are entered without echo.')
    objPath = Path(sys.argv[1] if len(sys.argv) > 1 else '/etc/luigis.env')
    if os.name != 'nt' and objPath.stat().st_uid != os.getuid():
        raise ValueError('Run as the config file owner (sudo for /etc/luigis.env).')
    strKey = getpass.getpass('Stripe sandbox secret API key (hidden): ').strip()
    strWebhook = getpass.getpass('Sandbox webhook signing secret (hidden): ').strip()
    objValues = sandbox_settings(strKey, strWebhook)
    objPath.write_text(merge_settings(objPath.read_text(), objValues))
    if os.name != 'nt':
        objPath.chmod(0o640)
    print('Sandbox credentials saved. New card checkout remains disabled until payment tests are ready.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyboardInterrupt, EOFError):
        print('Stripe configuration was not saved. Use the correct sandbox keys in an interactive terminal.', file=sys.stderr)
        sys.exit(1)
