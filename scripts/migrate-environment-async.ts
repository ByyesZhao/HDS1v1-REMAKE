import {inspectEnvironmentAsyncUpgrade,upgradeEnvironmentAsync} from '../src/deployment/environment-async-upgrade';
const args=process.argv.slice(2),value=(key:string)=>args[args.indexOf(key)+1],path=value('--database'),targetRaw=args.includes('--target-version')?value('--target-version'):'2';
if(!args.includes('--database')||!path||!['1','2'].includes(targetRaw)||(!args.includes('--check')&&!args.includes('--apply')))throw Error('Supply --database <path> --check or --apply --stopped --backup-dir <path>, optional --target-version 1|2');
const targetVersion=Number(targetRaw) as 1|2;
if(args.includes('--apply')&&(!args.includes('--backup-dir')||!value('--backup-dir')))throw Error('Supply --backup-dir');
const report=args.includes('--apply')?upgradeEnvironmentAsync(path,{stopped:args.includes('--stopped'),backupDir:value('--backup-dir'),targetVersion}):inspectEnvironmentAsyncUpgrade(path,targetVersion);
console.log(JSON.stringify(report,null,2));
if(!report.canUpgrade)process.exitCode=1;
