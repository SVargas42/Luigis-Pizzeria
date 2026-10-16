"""Scoped deployment helper for the audited Debian Luigi's server.

Usage: sudo python3 ordering/deploy/lifecycle_deploy.py prepare|verify|activate|smoke
Prepare stages files and backs up source/config/database. Verify uses an isolated
restored database. Activate requires successful verification and an explicit tax rate.
"""
import argparse
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

pathLive = Path('/opt/luigis')
pathState = Path('/var/backups/luigis-lifecycle/deployment.json')
pathVenv = Path('/opt/luigis-lifecycle-venv')
pathEnvironment = Path('/etc/luigis.env')


def run(arrCommand, **objOptions):
    return subprocess.run(arrCommand, check=True, **objOptions)


def sql(strDatabase, strSql):
    return run(['mariadb', '--batch', '--skip-column-names', strDatabase], input=strSql, text=True, capture_output=True).stdout


def digest(pathFile):
    return hashlib.sha256(pathFile.read_bytes().replace(b'\r\n', b'\n')).hexdigest() if pathFile.exists() else None


def save_state(objState):
    pathState.write_text(json.dumps(objState, indent=2))
    pathState.chmod(0o600)


def read_environment():
    objEnvironment = dict(os.environ)
    for strLine in pathEnvironment.read_text().splitlines():
        strLine = strLine.strip()
        if not strLine or strLine.startswith('#'):
            continue
        strKey, strValue = strLine.split('=', 1)
        arrValue = shlex.split(strValue, comments=False)
        objEnvironment[strKey.strip()] = ' '.join(arrValue) if arrValue else ''
    return objEnvironment


def backup_database(pathOutput):
    with pathOutput.open('wb') as objOutput:
        run(['mariadb-dump', '--single-transaction', '--routines', '--events', 'luigis'], stdout=objOutput)
    pathOutput.chmod(0o600)
    assert pathOutput.stat().st_size > 100, 'Database dump is empty'


def prepare(pathPayload):
    if pathState.exists():
        raise RuntimeError('A deployment state already exists; inspect it before starting another deployment')
    objManifest = json.loads((pathPayload / 'lifecycle-manifest.json').read_text())
    for strRelative, objHashes in objManifest.items():
        pathRelative = Path(strRelative)
        assert not pathRelative.is_absolute() and '..' not in pathRelative.parts
        assert strRelative == 'index.html' or strRelative.startswith('ordering/')
        assert digest(pathPayload / pathRelative) == objHashes['new'], f'Bundle hash mismatch: {strRelative}'
        assert digest(pathLive / pathRelative) in (objHashes['old'], objHashes['new']), f'Live file changed since base: {strRelative}'
    strTimestamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    pathBackup = pathState.parent / strTimestamp
    pathBackup.mkdir(parents=True, mode=0o700)
    pathState.parent.chmod(0o700)
    pathStage = Path('/opt/luigis-staging') / strTimestamp
    shutil.copytree(pathLive, pathStage, ignore=shutil.ignore_patterns('node_modules', '__pycache__', '.pytest_cache'))
    (pathStage / 'ordering/node_modules').symlink_to(pathLive / 'ordering/node_modules', target_is_directory=True)
    for strRelative in objManifest:
        pathSource = pathPayload / strRelative
        pathTarget = pathStage / strRelative
        pathTarget.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(pathSource, pathTarget)
        pathTarget.chmod(0o644)
        if (pathLive / strRelative).exists():
            pathOriginal = pathBackup / 'files' / strRelative
            pathOriginal.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(pathLive / strRelative, pathOriginal)
    shutil.copy2(pathEnvironment, pathBackup / 'luigis.env')
    (pathBackup / 'luigis.env').chmod(0o600)
    shutil.copy2('/etc/systemd/system/luigis.service', pathBackup / 'luigis.service')
    with tarfile.open(pathBackup / 'source.tar.gz', 'w:gz') as objTar:
        objTar.add(pathLive, arcname='luigis')
    backup_database(pathBackup / 'database.sql')
    strUser = run(['systemctl', 'show', 'luigis', '-p', 'User', '--value'], text=True, capture_output=True).stdout.strip()
    assert re.fullmatch(r'[a-z_][a-z0-9_-]*', strUser), 'Expected an existing unprivileged service user'
    objState = {'backup': str(pathBackup), 'stage': str(pathStage), 'database': 'luigis_lifecycle_check_' + strTimestamp.lower(),
                'files': objManifest, 'user': strUser, 'verified': False, 'activated': False}
    save_state(objState)
    print(f'PREPARED backup={pathBackup} stage={pathStage}; live source and database unchanged', flush=True)


def verify(objState):
    pathStage = Path(objState['stage'])
    assert (pathVenv / 'bin/python').is_file(), 'Install the dedicated virtual environment first'
    strDatabase = objState['database']
    assert re.fullmatch(r'luigis_lifecycle_check_[a-z0-9]+', strDatabase)
    sql('mysql', f'CREATE DATABASE IF NOT EXISTS `{strDatabase}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;')
    strReady = sql(strDatabase, "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='tracking_token';").strip()
    if strReady != '1':
        with (Path(objState['backup']) / 'database.sql').open('rb') as objDump:
            run(['mariadb', strDatabase], stdin=objDump)
        sql(strDatabase, (pathStage / 'ordering/db/002_lifecycle.sql').read_text())
    objEnvironment = read_environment()
    objEnvironment.update(SITE_URL='https://luigispizza.duckdns.org', TAX_BASIS_POINTS='975', RUN_DB_TEST='0', PYTHONDONTWRITEBYTECODE='1')
    for strKey in list(objEnvironment):
        if strKey.startswith('SMTP_'):
            del objEnvironment[strKey]
    run(['node', '--test', '--test-reporter=spec'], cwd=pathStage / 'ordering', env=objEnvironment)
    run([str(pathVenv / 'bin/python'), '-m', 'pytest', 'ordering/lifecycle/tests', '-q', '-p', 'no:cacheprovider'], cwd=pathStage, env=objEnvironment)
    run([str(pathVenv / 'bin/python'), str(pathStage / 'ordering/deploy/lifecycle_verify.py'), '--database', strDatabase], cwd=pathStage, env=objEnvironment)
    objState['verified'] = True
    save_state(objState)
    print('VERIFIED isolated restore, migration, Node suite, API suite and MariaDB lifecycle integration', flush=True)


def atomic_copy(pathSource, pathTarget):
    arrNewDirectories = []
    pathDirectory = pathTarget.parent
    while not pathDirectory.exists():
        arrNewDirectories.append(pathDirectory)
        pathDirectory = pathDirectory.parent
    pathTarget.parent.mkdir(parents=True, exist_ok=True)
    for pathDirectory in arrNewDirectories:
        pathDirectory.chmod(0o755)
    with tempfile.NamedTemporaryFile(dir=pathTarget.parent, delete=False) as objTemporary:
        pathTemporary = Path(objTemporary.name)
    shutil.copy2(pathSource, pathTemporary)
    pathTemporary.chmod(0o644)
    pathTemporary.replace(pathTarget)


def activate(objState, nTax):
    assert objState['verified'] and not objState['activated'], 'Verification required; activation must only run once'
    assert nTax == 975, 'This deployment was approved and tested at 9.75%'
    pathStage = Path(objState['stage'])
    pathBackup = Path(objState['backup'])
    for strRelative, objHashes in objState['files'].items():
        assert digest(pathLive / strRelative) in (objHashes['old'], objHashes['new']), f'Live file drift: {strRelative}'
        assert digest(pathStage / strRelative) == objHashes['new'], f'Stage file drift: {strRelative}'
    assert 'tracking_token' not in sql('luigis', 'SHOW COLUMNS FROM orders;'), 'Inspect existing migration state before proceeding'
    backup_database(pathBackup / 'database-before-migration.sql')
    sql('luigis', (pathStage / 'ordering/db/002_lifecycle.sql').read_text())
    objState['migration_applied'] = True
    save_state(objState)
    objSettings = {'SITE_URL': 'https://luigispizza.duckdns.org', 'LIFECYCLE_URL': 'http://127.0.0.1:8000', 'TAX_BASIS_POINTS': str(nTax)}
    arrLines = [strLine for strLine in pathEnvironment.read_text().splitlines() if strLine.split('=', 1)[0].strip() not in objSettings]
    pathEnvironment.write_text('\n'.join(arrLines + [f'{strKey}={strValue}' for strKey, strValue in objSettings.items()]) + '\n')
    pathEnvironment.chmod(0o600)
    try:
        for strRelative in objState['files']:
            atomic_copy(pathStage / strRelative, pathLive / strRelative)
        strService = f'''[Unit]
Description=Luigi's FastAPI order lifecycle
After=network.target mariadb.service

[Service]
Type=simple
User={objState['user']}
WorkingDirectory=/opt/luigis
EnvironmentFile=/etc/luigis.env
Environment=PYTHONDONTWRITEBYTECODE=1
ExecStart=/opt/luigis-lifecycle-venv/bin/python -m uvicorn ordering.lifecycle.app:app --host 127.0.0.1 --port 8000 --no-access-log
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
UMask=0077

[Install]
WantedBy=multi-user.target
'''
        pathService = Path('/etc/systemd/system/luigis-lifecycle.service')
        assert not pathService.exists(), 'Existing lifecycle service requires manual review'
        pathService.write_text(strService)
        pathService.chmod(0o644)
        run(['systemctl', 'daemon-reload'])
        run(['systemctl', 'enable', '--now', 'luigis-lifecycle'])
        run(['systemctl', 'restart', 'luigis'])
        run(['systemctl', 'is-active', 'luigis', 'luigis-lifecycle'])
    except Exception:
        for strRelative in objState['files']:
            pathOriginal = pathBackup / 'files' / strRelative
            if pathOriginal.exists():
                atomic_copy(pathOriginal, pathLive / strRelative)
        shutil.copy2(pathBackup / 'luigis.env', pathEnvironment)
        subprocess.run(['systemctl', 'stop', 'luigis-lifecycle'], check=False)
        subprocess.run(['systemctl', 'restart', 'luigis'], check=False)
        print('Activation failed: original Node source/environment restored; additive DB columns retained', flush=True)
        raise
    objState['activated'] = True
    save_state(objState)
    print('ACTIVATED services with 9.75% tax; no public FastAPI port', flush=True)


def main():
    assert os.geteuid() == 0, 'Run through sudo'
    os.umask(0o077)
    objParser = argparse.ArgumentParser()
    objParser.add_argument('action', choices=['prepare', 'verify', 'activate', 'smoke'])
    objParser.add_argument('--tax-basis-points', type=int)
    objArgs = objParser.parse_args()
    if objArgs.action == 'prepare':
        prepare(Path(__file__).resolve().parents[2])
        return
    objState = json.loads(pathState.read_text())
    if objArgs.action == 'verify':
        verify(objState)
    elif objArgs.action == 'activate':
        activate(objState, objArgs.tax_basis_points)
    else:
        assert objState['activated'], 'Activate before live smoke verification'
        run([str(pathVenv / 'bin/python'), str(pathLive / 'ordering/deploy/lifecycle_verify.py'), '--live'], cwd=pathLive, env=read_environment())
        objState['smoke_passed'] = True
        save_state(objState)
        print('LIVE SMOKE PASSED; labeled deployment test order archived', flush=True)


if __name__ == '__main__':
    main()
