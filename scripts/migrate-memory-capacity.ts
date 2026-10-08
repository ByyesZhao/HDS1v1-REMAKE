import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {memoryMaintenanceSettings} from '../src/settings';
import {inspectMemoryCapacity,upgradeMemoryCapacity} from '../src/deployment/memory-capacity-upgrade';
const args=process.argv.slice(2),value=(flag:string)=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
const path=args.find((a,i)=>!a.startsWith('--')&&(i===0||!['--config','--backup-dir'].includes(args[i-1])));
if(!path)throw Error('Usage: memory:capacity -- <db> [--config <json>] [--dry-run | --apply --stopped]');
const configPath=resolve(value('--config')??'config.local.json'),raw=JSON.parse(readFileSync(configPath,'utf8'));
const memory=memoryMaintenanceSettings.parse(raw.memory??{}),at=new Date().toISOString(),database=resolve(path);
let report=inspectMemoryCapacity(database,at,memory.capacity);
if(args.includes('--apply')){
  const applied=upgradeMemoryCapacity(database,at,{stopped:args.includes('--stopped'),config:memory.capacity,backupDirectory:value('--backup-dir')?resolve(value('--backup-dir')!):undefined});
  report={...inspectMemoryCapacity(database,at,memory.capacity),backupPath:applied.backupPath};
}
console.log(JSON.stringify({mode:args.includes('--apply')?'apply':'dry-run',database,configSource:configPath,...report},null,2));
