import {writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';

export function renderServices(strProject,strNode,strUser){
 for(const strPath of [strProject,strNode])if(typeof strPath!=='string'||!/^\/[a-zA-Z0-9_./-]+$/.test(strPath)||strPath.split('/').includes('..'))throw Error('Use absolute Linux paths without spaces or special characters.');
 if(!/^[a-z_][a-z0-9_-]*$/.test(strUser||'')||strUser==='root')throw Error('Use the normal non-root SSH username.');
 const strCommon=`Type=simple\nUser=${strUser}\nEnvironmentFile=${strProject}/ordering/.env\nRestart=on-failure\nRestartSec=5\nNoNewPrivileges=true\nPrivateTmp=true\nUMask=0077\n`;
 return {
  'luigis-lifecycle.service':`[Unit]\nDescription=Luigi order lifecycle service\nAfter=network.target mariadb.service\nRequires=mariadb.service\n\n[Service]\n${strCommon}WorkingDirectory=${strProject}\nEnvironment=PYTHONDONTWRITEBYTECODE=1\nExecStart=${strProject}/.venv/bin/python -m uvicorn ordering.lifecycle.app:app --host 127.0.0.1 --port 8000\n\n[Install]\nWantedBy=multi-user.target\n`,
  'luigis-web.service':`[Unit]\nDescription=Luigi ordering website\nAfter=network.target mariadb.service luigis-lifecycle.service\nRequires=mariadb.service\nWants=luigis-lifecycle.service\n\n[Service]\n${strCommon}WorkingDirectory=${strProject}/ordering\nExecStart=${strNode} ${strProject}/ordering/server.js\n\n[Install]\nWantedBy=multi-user.target\n`
 };
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(process.argv.length!==6)throw Error('Usage: node deploy/render-services.js PROJECT_PATH NODE_PATH USER OUTPUT_DIRECTORY');const objUnits=renderServices(...process.argv.slice(2,5));mkdirSync(process.argv[5],{recursive:true});for(const [strName,strContent]of Object.entries(objUnits))writeFileSync(join(process.argv[5],strName),strContent);console.log('Rendered service units. Inspect them before installing with sudo.');}catch(objError){console.error(objError.message);process.exitCode=1;}
}
