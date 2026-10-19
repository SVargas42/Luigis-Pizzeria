import {readFileSync,appendFileSync,writeFileSync,existsSync,chmodSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function mergeEnvironment(strExisting,strExample){
 const setExisting=new Set([...strExisting.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map(objMatch=>objMatch[1]));
 const arrMissing=strExample.split(/\r?\n/).filter(strLine=>{const objMatch=strLine.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);return objMatch&&!setExisting.has(objMatch[1]);});
 return arrMissing.length?`${strExisting.endsWith('\n')||!strExisting?'':'\n'}\n# Added deployment settings; fill in your own credentials and domain.\n${arrMissing.join('\n')}\n`:'';
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const strPath=new URL('../.env',import.meta.url),strExample=readFileSync(new URL('../.env.example',import.meta.url),'utf8');
 if(!existsSync(strPath)){writeFileSync(strPath,strExample,{mode:0o600});console.log('Created .env from the template. Configure its values before starting.');}
 else{const strAppend=mergeEnvironment(readFileSync(strPath,'utf8'),strExample);if(strAppend)appendFileSync(strPath,strAppend);console.log(strAppend?'Added missing setting names. Existing values were preserved; configure the added values.':'All setting names already exist; existing values were preserved.');}
 if(process.platform!=='win32')chmodSync(strPath,0o600);
}
