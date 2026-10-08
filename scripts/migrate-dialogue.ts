import { resolve } from 'node:path';
import { inspectDialogueUpgrade,upgradeDialogue } from '../src/deployment/dialogue-upgrade';
const args=process.argv.slice(2),value=(key:string)=>{const i=args.indexOf(key);return i<0?undefined:args[i+1];};
const path=resolve(value('--database')??'runtime/data/hdsi-remake.sqlite');
if(args.includes('--check')&&args.includes('--apply'))throw new Error('Choose --check or --apply.');
const backup=value('--backup-dir');if(args.includes('--apply')&&!backup)throw new Error('--apply requires --backup-dir.');
console.log(JSON.stringify(args.includes('--apply')?upgradeDialogue(path,new Date().toISOString(),{stopped:args.includes('--stopped'),backupDirectory:resolve(backup!)}):inspectDialogueUpgrade(path),null,2));
