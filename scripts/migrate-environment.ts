import {resolve} from 'node:path';
import {inspectEnvironmentUpgrade,upgradeEnvironment} from '../src/deployment/environment-upgrade';
import {loadSettings,connectionFor,modelRoles} from '../src/settings';
const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const database=resolve(value('--database')??'runtime/data/hdsi-remake.sqlite');
if(args.includes('--apply')&&args.includes('--check'))throw Error('Choose --check or --apply');
let report;
if(args.includes('--apply')){
 const backupDir=value('--backup-dir');if(!backupDir)throw Error('--apply requires --backup-dir');
 const settings=loadSettings(resolve(value('--config')??'config.local.json'));modelRoles.forEach(role=>connectionFor(settings,role));
 report=upgradeEnvironment(database,{stopped:args.includes('--stopped'),backupDir:resolve(backupDir),timezone:settings.timezone,environmentDailyAt:settings.environmentDailyAt,now:value('--now')??new Date().toISOString()});
}else report=inspectEnvironmentUpgrade(database);
console.log(JSON.stringify(report,null,2));
