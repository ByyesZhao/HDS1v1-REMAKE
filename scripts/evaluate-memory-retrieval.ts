import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defaultCalibration } from '../src/memory/retrieval';
import { evaluateRetrievalDataset, evaluatePairedHoldout, selectLexicalCalibration, loadRetrievalDataset, retrievalDatasetHash, validateCalibration, validateFrozenCandidate, type RetrievalSplit } from './lib/memory-retrieval-evaluation';

function sameFile(input:string,output:string):boolean {
  const left=resolve(input),right=resolve(output);
  if((process.platform==='win32'?left.toLowerCase():left)===(process.platform==='win32'?right.toLowerCase():right))return true;
  const a=statSync(left,{bigint:true,throwIfNoEntry:false}),b=statSync(right,{bigint:true,throwIfNoEntry:false});
  return !!a&&!!b&&a.dev===b.dev&&a.ino===b.ino;
}
const hash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
function writeJson(path:string,value:unknown,exclusive=false):void {
  mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:exclusive?'wx':'w'});
}
async function main():Promise<void> {
  const args=process.argv.slice(2),options=new Map<string,string>();
  const allowed=new Set(['--dataset','--report','--calibration','--splits','--candidate','--candidate-hash','--select-lexical']);
  for(let i=0;i<args.length;i++){
    const flag=args[i];if(!allowed.has(flag)||options.has(flag))throw Error(`invalid argument ${flag}`);
    if(flag==='--select-lexical'){options.set(flag,'true');continue;}
    const value=args[++i];if(!value||value.startsWith('--'))throw Error(`invalid argument ${flag}`);options.set(flag,value);
  }
  if(!options.has('--dataset')||!options.has('--report'))throw Error('required: --dataset <json> --report <json>');
  const datasetPath=resolve(options.get('--dataset')!),reportPath=resolve(options.get('--report')!),usagePath=datasetPath+'.holdout-used.json';
  const selecting=options.has('--select-lexical'),candidatePath=options.has('--candidate')?resolve(options.get('--candidate')!):null;
  const splits=(options.get('--splits')??'development,calibration').split(',') as RetrievalSplit[];
  if(!splits.length||splits.some(s=>!['development','calibration','holdout'].includes(s))||new Set(splits).size!==splits.length)throw Error('invalid --splits');
  const holdout=splits.includes('holdout');
  if(holdout&&(splits.length!==1||splits[0]!=='holdout'))throw Error('paired holdout requires exactly --splits holdout');
  const paths=[datasetPath,reportPath,usagePath,...candidatePath?[candidatePath]:[],...options.has('--calibration')?[resolve(options.get('--calibration')!)]:[]];
  for(let i=0;i<paths.length;i++)for(let j=i+1;j<paths.length;j++)if(sameFile(paths[i],paths[j]))throw Error('output alias must not overwrite an input file or another output');
  if(selecting&&!candidatePath)throw Error('--select-lexical requires --candidate output');
  if(selecting&&options.has('--candidate-hash'))throw Error('--candidate-hash applies only to an existing frozen candidate');
  if(options.has('--calibration')&&(selecting||candidatePath||holdout))throw Error('--calibration cannot be combined with candidate selection/evaluation');
  if(options.has('--candidate-hash')&&!candidatePath)throw Error('--candidate-hash requires --candidate');
  if(candidatePath&&!selecting&&!options.has('--candidate-hash'))throw Error('existing frozen --candidate requires --candidate-hash');
  if(holdout&&!candidatePath)throw Error('holdout requires --select-lexical --candidate or an existing frozen --candidate and --candidate-hash');
  if(holdout&&existsSync(usagePath))throw Error('holdout already used; obtain a new unseen family holdout before further research');
  if(selecting&&candidatePath&&existsSync(candidatePath))throw Error('candidate output already exists; frozen candidates cannot be overwritten');
  const dataset=loadRetrievalDataset(datasetPath),datasetHash=retrievalDatasetHash(dataset);
  let frozenBytes:Buffer|undefined,candidateHash:string|undefined,calibration=defaultCalibration;
  if(selecting){
    const selected=await selectLexicalCalibration(dataset);
    writeJson(candidatePath!,selected,true);
    frozenBytes=readFileSync(candidatePath!);candidateHash=hash(frozenBytes);
    calibration=validateFrozenCandidate(frozenBytes,candidateHash,datasetHash).calibration;
    console.log(JSON.stringify({candidate:candidatePath,candidateHash,datasetHash,calibration}));
  } else if(candidatePath){
    frozenBytes=readFileSync(candidatePath);candidateHash=options.get('--candidate-hash')!;
    calibration=validateFrozenCandidate(frozenBytes,candidateHash,datasetHash).calibration;
  } else if(options.has('--calibration')){
    const loaded:unknown=JSON.parse(readFileSync(resolve(options.get('--calibration')!),'utf8'));
    const value=loaded&&typeof loaded==='object'&&'calibration' in loaded?loaded.calibration:loaded;
    validateCalibration(value);calibration=value;
  }
  if(holdout){
    if(calibration.semantic!==null)throw Error('lexical candidate semantic must be null');
    const usage={version:1,datasetHash,candidateHash,candidatePath,reportPath,holdoutFamilyIds:dataset.families.filter(f=>f.split==='holdout').map(f=>f.id),startedAt:new Date().toISOString(),status:'started'};
    // Exclusive claim survives evaluation/report failure, preventing retries from retuning on a seen holdout.
    writeJson(usagePath,usage,true);
    const paired=await evaluatePairedHoldout(dataset,frozenBytes!,candidateHash!);
    writeJson(reportPath,{...paired,holdoutUsage:{...usage,status:'completed',usagePath}});
    writeJson(usagePath,{...usage,status:'completed',completedAt:new Date().toISOString()});
    console.log(JSON.stringify({report:reportPath,datasetHash,candidateHash,recommendation:paired.recommendation,reasons:paired.reasons,recallGain:paired.recallGain},null,2));return;
  }
  const report=await evaluateRetrievalDataset(dataset,calibration,{splits});
  writeJson(reportPath,{...report,...candidateHash?{candidateHash}:{} });
  console.log(JSON.stringify({report:reportPath,datasetHash:report.datasetHash,candidateHash,splits,queries:report.queries.length,metrics:report.metrics,groups:report.groups,remoteRequests:report.remoteRequests,materializedVectorBytes:report.materializedVectorBytes},null,2));
}
main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
