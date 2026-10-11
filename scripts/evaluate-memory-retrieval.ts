import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defaultCalibration } from '../src/memory/retrieval';
import { evaluateRetrievalDataset, loadRetrievalDataset, retrievalDatasetHash, validateCalibration, validateFrozenCandidate, type RetrievalSplit } from './lib/memory-retrieval-evaluation';

function sameFile(input:string,output:string):boolean {
  const left=resolve(input),right=resolve(output);
  if((process.platform==='win32'?left.toLowerCase():left)===(process.platform==='win32'?right.toLowerCase():right))return true;
  // stat follows symlinks and identifies hard links without relying on realpath availability.
  const a=statSync(left,{bigint:true,throwIfNoEntry:false}),b=statSync(right,{bigint:true,throwIfNoEntry:false});
  return !!a&&!!b&&a.dev===b.dev&&a.ino===b.ino;
}

async function main():Promise<void> {
  const args=process.argv.slice(2),options=new Map<string,string>();
  const allowed=new Set(['--dataset','--report','--calibration','--splits','--candidate','--candidate-hash']);
  for(let i=0;i<args.length;i+=2){const flag=args[i],value=args[i+1];if(!allowed.has(flag)||!value||value.startsWith('--')||options.has(flag))throw Error(`invalid argument ${flag}`);options.set(flag,value);}
  if(!options.has('--dataset')||!options.has('--report'))throw Error('required: --dataset <json> --report <json>');
  const datasetPath=resolve(options.get('--dataset')!),reportPath=resolve(options.get('--report')!);
  for(const flag of ['--dataset','--calibration','--candidate'])if(options.has(flag)&&sameFile(options.get(flag)!,reportPath))throw Error('report path must not overwrite an input file');
  const splits=(options.get('--splits')??'development,calibration').split(',') as RetrievalSplit[];
  if(!splits.length||splits.some(s=>!['development','calibration','holdout'].includes(s))||new Set(splits).size!==splits.length)throw Error('invalid --splits');
  const dataset=loadRetrievalDataset(datasetPath);
  if(splits.includes('holdout')){
    if(!options.has('--candidate')||!options.has('--candidate-hash'))throw Error('holdout requires an existing frozen --candidate and --candidate-hash; Q1 does not evaluate holdout');
    validateFrozenCandidate(readFileSync(resolve(options.get('--candidate')!)),options.get('--candidate-hash')!,retrievalDatasetHash(dataset));
    throw Error('holdout evaluation requires the Q2 paired baseline/candidate entry point; Q1 keeps holdout sealed');
  }
  let calibration=defaultCalibration;
  if(options.has('--calibration')){
    const loaded:unknown=JSON.parse(readFileSync(resolve(options.get('--calibration')!),'utf8'));
    const value=loaded&&typeof loaded==='object'&&'calibration' in loaded?loaded.calibration:loaded;
    validateCalibration(value);calibration=value;
  }
  const report=await evaluateRetrievalDataset(dataset,calibration,{splits});
  mkdirSync(dirname(reportPath),{recursive:true});writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({report:reportPath,datasetHash:report.datasetHash,splits,queries:report.queries.length,metrics:report.metrics,groups:report.groups,remoteRequests:report.remoteRequests,materializedVectorBytes:report.materializedVectorBytes},null,2));
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
