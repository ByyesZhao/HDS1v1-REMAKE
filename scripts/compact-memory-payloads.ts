import {resolve} from 'node:path';
import {inspectCompletedPayloads,compactMemoryPayloads} from '../src/deployment/memory-payload-compaction';
const args=process.argv.slice(2),valued=['--batch-size','--max-batches','--backup-dir'],flags=['--dry-run','--apply','--stopped',...valued];
const values=new Map<string,string>();let database:string|undefined;
for(let i=0;i<args.length;i++){const arg=args[i];if(valued.includes(arg)){if(!args[i+1]||args[i+1].startsWith('--'))throw Error('missing value for '+arg);values.set(arg,args[++i]);}else if(arg.startsWith('--')){if(!flags.includes(arg))throw Error('unknown option '+arg);}else{if(database)throw Error('only one database path is accepted');database=resolve(arg);}}
if(!database||args.includes('--apply')&&args.includes('--dry-run'))throw Error('Usage: memory:compact-payloads -- <db> [--dry-run | --apply --stopped] [--batch-size 50] [--max-batches 20] [--backup-dir <path>]');
const positive=(flag:string)=>{const raw=values.get(flag);if(raw===undefined)return undefined;const n=Number(raw);if(!Number.isInteger(n)||n<=0)throw Error(flag+' must be a positive integer');return n;};
const batchSize=positive('--batch-size'),maxBatches=positive('--max-batches');
const report=args.includes('--apply')?compactMemoryPayloads(database,{stopped:args.includes('--stopped'),batchSize,maxBatches,backupDirectory:values.has('--backup-dir')?resolve(values.get('--backup-dir')!):undefined}):inspectCompletedPayloads(database);
console.log(JSON.stringify({mode:args.includes('--apply')?'apply':'dry-run',database,...report},null,2));
