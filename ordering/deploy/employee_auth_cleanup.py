"""Guarded employee authorization update. Defaults to read-only preflight."""
import argparse
from datetime import datetime,timezone
from pathlib import Path
import ast
import subprocess

arrEdits = [('ordering/server.js', "  if(bLifecycleRoute){\n   if(url.pathname.startsWith('/api/employee/')&&!await isAllowedStaffRequest(req,url)){\n    return send(res,403,{error:'Administrator account required'});\n   }\n   let objSubmit=['POST','PATCH'].includes(req.method)?await body(req):undefined;\n   const objActor=await resolveIdentity(req);\n", "  if(bLifecycleRoute){\n   const objActor=await resolveIdentity(req);\n   if(url.pathname.startsWith('/api/employee/')&&(!['admin','worker'].includes(objActor?.role)||!canAccessStaffRoute(objActor.role,url,req.method))){\n    return send(res,403,{error:'A worker or administrator account is required.'});\n   }\n   let objSubmit=['POST','PATCH'].includes(req.method)?await body(req):undefined;\n"), ('ordering/server.js', "'X-Luigi-Actor':objActor.email,Authorization:", "'X-Luigi-Actor':objActor.email,Cookie:req.headers.cookie||'',Authorization:"), ('ordering/lifecycle/app.py', 'import logging\n', 'import logging\nimport hashlib\n'), ('ordering/lifecycle/app.py', "@app.middleware('http')", "def require_employee(objRequest: Request, objInternalAuth=Depends(require_staff)):\n    # The internal credential authenticates the proxy; the session identifies its user.\n    strToken = objRequest.cookies.get('luigi_session', '')\n    if not re.fullmatch(r'[a-f0-9]{64}', strToken):\n        raise HTTPException(401, 'A valid staff session is required')\n    with database() as objCursor:\n        objCursor.execute('''SELECT a.role FROM account_sessions s\n            JOIN accounts a ON a.id=s.account_id\n            WHERE s.token_hash=%s AND s.expires_at>UTC_TIMESTAMP()\n            AND a.disabled_at IS NULL AND a.email_verified_at IS NOT NULL''',\n            (hashlib.sha256(strToken.encode()).hexdigest(),))\n        objAccount = objCursor.fetchone()\n    if not objAccount:\n        raise HTTPException(401, 'A valid staff session is required')\n    if objAccount['role'] not in ('admin', 'worker'):\n        raise HTTPException(403, 'A worker or administrator account is required')\n\n\n@app.middleware('http')"), ('ordering/lifecycle/app.py', "@app.get('/api/employee/orders/active', dependencies=[Depends(require_staff)])", "@app.get('/api/employee/orders/active', dependencies=[Depends(require_employee)])"), ('ordering/lifecycle/app.py', "@app.patch('/api/employee/orders/{nOrderId}/status', dependencies=[Depends(require_staff)])", "@app.patch('/api/employee/orders/{nOrderId}/status', dependencies=[Depends(require_employee)])"), ('ordering/lifecycle/app.py', "@app.patch('/api/employee/orders/{nOrderId}/estimate', dependencies=[Depends(require_staff)])", "@app.patch('/api/employee/orders/{nOrderId}/estimate', dependencies=[Depends(require_employee)])"), ('ordering/lifecycle/app.py', "@app.post('/api/employee/orders/{nOrderId}/complete', dependencies=[Depends(require_staff)])", "@app.post('/api/employee/orders/{nOrderId}/complete', dependencies=[Depends(require_employee)])")]


def transformed(strPath,strSource):
    for strTarget,strOld,strNew in arrEdits:
        if strTarget != strPath:
            continue
        if strNew in strSource:
            continue
        elif strSource.count(strOld)==1:
            strSource=strSource.replace(strOld,strNew,1)
        else:
            raise ValueError('Unexpected live code in '+strPath+'; no changes made.')
    return strSource


def main():
    objParser=argparse.ArgumentParser(description=__doc__)
    objParser.add_argument('--apply',action='store_true')
    objArgs=objParser.parse_args()
    objRoot=Path('/opt/luigis')
    arrChanges=[]
    for strPath in dict.fromkeys(objEdit[0] for objEdit in arrEdits):
        objPath=objRoot/strPath
        bufBefore=objPath.read_bytes()
        strAfter=transformed(strPath,bufBefore.decode('utf-8'))
        if strPath.endswith('.py'):
            ast.parse(strAfter)
        else:
            subprocess.run(['node','--input-type=module','--check'],input=strAfter.encode('utf-8'),check=True)
        if strAfter.encode('utf-8')!=bufBefore:
            arrChanges.append((objPath,bufBefore,strAfter.encode('utf-8')))
            print('READY',objPath)
    if not objArgs.apply:
        print('READ ONLY:',len(arrChanges),'files would change.')
        return
    strStamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    for objPath,bufBefore,bufAfter in arrChanges:
        objBackup=objPath.with_name(objPath.name+'.bak-rbac-'+strStamp)
        if objBackup.exists():
            raise FileExistsError(str(objBackup))
        subprocess.run(['cp','--preserve=all','--no-clobber',str(objPath),str(objBackup)],check=True)
        if objBackup.read_bytes()!=bufBefore or objPath.read_bytes()!=bufBefore:
            raise RuntimeError('Backup mismatch or concurrent modification; no write performed.')
        print('BACKUP',objBackup)
    arrWritten=[]
    try:
        for objPath,bufBefore,bufAfter in arrChanges:
            if objPath.read_bytes()!=bufBefore:
                raise RuntimeError('Concurrent modification: '+str(objPath))
            arrWritten.append((objPath,bufBefore))
            objPath.write_bytes(bufAfter)
            if objPath.read_bytes()!=bufAfter:
                raise RuntimeError('Write verification failed: '+str(objPath))
            print('UPDATED',objPath)
    except Exception:
        for objPath,bufBefore in reversed(arrWritten):
            objPath.write_bytes(bufBefore)
        raise
    print('DONE. Restart Node first, then the lifecycle service. No database migration needed.')


if __name__=='__main__':
    main()
