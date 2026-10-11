import {resolve} from 'node:path';
import {inspectWebPayloadFile,migrateWebPayloads} from '../src/deployment/web-payload-migration';
function main(){
 const args=process.argv.slice(2),valued=['--batch-size','--max-batches','--backup-dir'],flags=['--dry-run','--apply','--stopped',...valued],values=new Map<string,string>(),seen=new Set<string>();let database:string|undefined;
 for(let i=0;i<args.length;i++){const arg=args[i];if(arg.startsWith('--')){if(!flags.includes(arg)||seen.has(arg))throw Error('unknown or duplicate option '+arg);seen.add(arg);if(valued.includes(arg)){if(!args[i+1]||args[i+1].startsWith('--'))throw Error('missing value for '+arg);values.set(arg,args[++i]);}}else{if(database)throw Error('only one database path is accepted');database=resolve(arg);}}
 if(!database||seen.has('--apply')&&seen.has('--dry-run'))throw Error('Usage: web:migrate-payloads -- <db> [--dry-run | --apply --stopped] [--batch-size 50] [--max-batches 20] [--backup-dir <path>]');
 const positive=(flag:string)=>{const raw=values.get(flag);if(raw===undefined)return undefined;const value=Number(raw);if(!/^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(value))throw Error(flag+' must be a positive integer');return value;};
 const batchSize=positive('--batch-size'),maxBatches=positive('--max-batches');if(batchSize!==undefined&&batchSize>50)throw Error('--batch-size must be at most 50');
 const report=seen.has('--apply')?migrateWebPayloads(database,{stopped:seen.has('--stopped'),batchSize,maxBatches,backupDirectory:values.has('--backup-dir')?resolve(values.get('--backup-dir')!):undefined}):inspectWebPayloadFile(database);
 console.log(JSON.stringify({mode:seen.has('--apply')?'apply':'dry-run',database,...report},null,2));
}
try{main();}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}
