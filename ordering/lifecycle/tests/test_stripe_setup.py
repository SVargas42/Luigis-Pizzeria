import importlib.util
from pathlib import Path
import pytest

objSpec = importlib.util.spec_from_file_location('stripe_setup', Path(__file__).parents[2] / 'scripts' / 'configure-stripe.py')
objSetup = importlib.util.module_from_spec(objSpec)
objSpec.loader.exec_module(objSetup)


def test_sandbox_setup_never_enables_checkout():
    objValues = objSetup.sandbox_settings('sk_test_example123', 'whsec_example123')
    assert objValues['STRIPE_MODE'] == 'test'
    assert objValues['STRIPE_ENABLED'] == '0'


@pytest.mark.parametrize('strKey', ['sk_live_example', 'pk_test_example', '', 'sk_test_bad\nvalue'])
def test_live_publishable_and_malformed_keys_are_rejected(strKey):
    with pytest.raises(ValueError):
        objSetup.sandbox_settings(strKey, 'whsec_example123')


def test_merge_preserves_database_and_email_credentials():
    strExisting = 'DB_PASSWORD="preserve-db"\nSMTP_PASSWORD="preserve-mail"\nSTRIPE_ENABLED=1\n'
    objValues = objSetup.sandbox_settings('sk_test_example123', 'whsec_example123')
    strResult = objSetup.merge_settings(strExisting, objValues)
    assert 'DB_PASSWORD="preserve-db"' in strResult
    assert 'SMTP_PASSWORD="preserve-mail"' in strResult
    assert strResult.count('STRIPE_ENABLED=') == 1
    assert objSetup.merge_settings(strResult, objValues) == strResult
