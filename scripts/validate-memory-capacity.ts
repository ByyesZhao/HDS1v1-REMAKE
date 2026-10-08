import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,basename,resolve} from 'node:path';
import {runMemoryCapacityAcceptance} from './memory-capacity-acceptance';
import {runMemoryCapacityOnlineAcceptance} from './memory-capacity-online-acceptance';
async function main(){
 const args=process.argv.slice(2),index=args.indexOf('--db');if(index<0||!args[index+1])throw Error('Supply --db <new isolated database>');const path=resolve(args[index+1]);
 if(existsSync(path)||basename(path)==='hdsi-remake.sqlite')throw Error('Acceptance requires a new isolated database; existing/production files are forbidden');
 const configIndex=args.indexOf('--config');if(args.includes('--online')&&(configIndex<0||!args[configIndex+1]))throw Error('--online requires --config <authorized local configuration>');
 mkdirSync(dirname(path),{recursive:true});const started=Date.now(),offline=await runMemoryCapacityAcceptance(path);
 const online=args.includes('--online')?await runMemoryCapacityOnlineAcceptance(path+'.online.sqlite',resolve(args[configIndex+1])):null;
 const report={mode:online?'offline+online':'offline',database:path,scope:'isolated simulated stories only; no QQ, private chats or image input',...offline,online,elapsedMs:Date.now()-started};
 writeFileSync(path+'.report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
