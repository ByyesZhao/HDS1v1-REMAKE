import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { Storage } from '../src/storage';
import { MemoryStore } from '../src/memory/store';
import { loadSettings, modelRoles } from '../src/settings';
import { assembleMemory } from '../src/deployment/memory-runtime';
import { ScriptedModels } from './helpers';
import { defaultCalibration, makeRetrievalRequest } from '../src/memory/retrieval';
import * as evaluation from '../scripts/lib/memory-retrieval-evaluation';
import type { RetrievalDatasetV2, RetrievalFamilyV2, RetrievalQueryV2, EvaluationMetrics } from '../scripts/lib/memory-retrieval-evaluation';

const AT='2026-10-11T10:00:00+08:00';
const hash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
function sample(group:'fact'|'experience'='fact',split:'calibration'|'holdout'='calibration',id:string=group):RetrievalDatasetV2 {
  const storage=new Storage(':memory:'),store=new MemoryStore(storage),kind=group==='fact'?'detail':'long';
  const owner=(suffix:string,content:string)=>store.makeOwner({ownerType:kind,ownerId:id+suffix},{content,sourceIds:[],key:`key-${id}-${suffix}`,value:content,aliases:[],effectiveAt:AT,retainedFrom:AT,expiresAt:'2027-01-01T00:00:00Z'},AT);
  const family:RetrievalFamilyV2={id,group,split,owners:[owner('a','alpha beta'),owner('b','delta epsilon'),owner('c','zeta eta'),owner('d','theta iota')],messages:[],turns:[],detailHistory:[]};storage.close();
  const query=(suffix:string,text:string,expected:RetrievalQueryV2['expectedOwnerKeys']):RetrievalQueryV2=>{
    text+=id==='fact'?'!':id==='experience'?'?':'?!';
    const request=makeRetrievalRequest(text,AT,'personal_chat');
    return {id:id+suffix,familyId:id,text,phase:request.phase,at:AT,permissions:request.permissions,scope:request.scope,includeDetailHistory:request.includeDetailHistory,category:expected.length?'paraphrase':'negative',candidateOwnerKeys:family.owners.map(o=>`${o.ownerType}:${o.ownerId}` as const),expectedOwnerKeys:expected,rationale:'Independent miniature synthetic label.'};
  };
  return {version:2,datasetId:'q2-unit',at:AT,families:[family],queries:[query('q','alpha beta gamma',[`${kind}:${id}a`]),query('n','omega',[])]};
}
function merge(...datasets:RetrievalDatasetV2[]):RetrievalDatasetV2{return {...datasets[0],families:datasets.flatMap(d=>d.families),queries:datasets.flatMap(d=>d.queries)};}

it('holdout_labels_cannot_change_selected_threshold',async()=>{
  const d=merge(sample(),sample('experience'),sample('fact','holdout','hidden'));
  const first=await evaluation.selectLexicalCalibration(d);
  d.queries.find(q=>q.familyId==='hidden')!.expectedOwnerKeys=['detail:invalid-holdout-label'];
  const second=await evaluation.selectLexicalCalibration(d);
  expect(first.calibration).toEqual({lexical:{fact:2/3,experience:2/3},semantic:null});
  expect(second.calibration).toEqual(first.calibration);expect(second.selection.groups).toEqual(first.selection.groups);
  expect(second.selection.datasetHash).not.toBe(first.selection.datasetHash);
});
it('precision_constraint_beats_recall',async()=>{
  const d=sample();d.families[0].owners[1].content='alpha beta impostor';
  const result=await evaluation.selectLexicalCalibration(d),low=result.selection.groups.fact.candidates.find(c=>c.threshold===2/3)!;
  expect(low.metrics).toMatchObject({TP:1,FP:1,FN:0,precision:0.5,recall:1});expect(low.eligible).toBe(false);
  expect(result.calibration.lexical.fact).toBe(1);
});
it('ties_choose_higher_threshold',async()=>{
  const d=sample();d.families[0].owners[0].key='pin';d.queries[0].text='pin alpha gamma';
  const result=await evaluation.selectLexicalCalibration(d);
  expect(result.selection.groups.fact.candidates.some(c=>c.threshold<1&&c.eligible)).toBe(true);
  expect(result.calibration.lexical.fact).toBe(1);
});
it('no_candidate_keeps_baseline',async()=>{
  const d=sample();d.queries=d.queries.filter(q=>q.category==='negative');
  const result=await evaluation.selectLexicalCalibration(d);
  expect(result.calibration).toEqual(defaultCalibration);
  expect(result.selection.groups.fact.candidates[0]).toMatchObject({threshold:1,eligible:false,metrics:{precision:null,recall:null,F1:null}});
});
it('new negative false hits disqualify an otherwise precise candidate',async()=>{
  const d=sample();d.queries=Array.from({length:30},(_,i)=>({...d.queries[0],id:`p-${i}`})).concat({...d.queries[1],text:'alpha omega'});
  const result=await evaluation.selectLexicalCalibration(d),low=result.selection.groups.fact.candidates.find(c=>c.threshold===0.5)!;
  expect(low.metrics.precision).toBeGreaterThan(0.95);expect(low.metrics.negativeFalseHits).toBe(1);expect(low.eligible).toBe(false);
  expect(result.calibration.lexical.fact).toBe(2/3);
});
it('candidate metrics reflect the actual SQL eligibility and direct-key pipeline',async()=>{
  const d=sample('experience');d.families[0].owners[1].content='alpha beta';d.families[0].owners[1].expiresAt='2026-01-01T00:00:00Z';
  const result=await evaluation.selectLexicalCalibration(d),report=await evaluation.evaluateRetrievalDataset(d,result.calibration,{splits:['calibration']});
  expect(result.calibration.lexical.experience).toBe(2/3);expect(report.metrics).toMatchObject({TP:1,FP:0,FN:0,precision:1});
  expect(result.selection.groups.experience.candidates.find(c=>c.threshold===2/3)!.metrics).toEqual(report.metrics);
});

const metrics=(precision:number|null,recall:number|null,negativeFalseHits=0):EvaluationMetrics=>({TP:1,FP:0,FN:0,precision,recall,F1:precision===null||recall===null?null:2*precision*recall/(precision+recall),negativeFalseHits,queryCount:2,negativeQueryCount:1});
it('recommendation requires both group precision, nonregression, ten recall points and defined candidate metrics',()=>{
  const base={metrics:metrics(1,0.5),groups:{fact:metrics(1,0.5),experience:metrics(null,0)}};
  const good={metrics:metrics(1,0.6),groups:{fact:metrics(1,0.6),experience:metrics(1,0.6)}};
  expect(evaluation.recommendLexicalCandidate(base,good).recommendation).toBe('recommend_candidate');
  for(const bad of [
    {...good,groups:{...good.groups,experience:metrics(0.94,1)}},
    {...good,groups:{...good.groups,fact:metrics(0.99,1)}},
    {...good,metrics:metrics(1,0.59)},
    {...good,metrics:metrics(1,0.8,1)},
    {...good,groups:{...good.groups,experience:metrics(null,0)}},
  ])expect(evaluation.recommendLexicalCandidate(base,bad).recommendation).toBe('keep_current');
  expect(evaluation.recommendLexicalCandidate({...base,metrics:metrics(null,null)},good).recommendation).toBe('keep_current');
});

function cliDataset():RetrievalDatasetV2 {
  const all:RetrievalDatasetV2[]=[];
  for(let i=0;i<60;i++){
    const group=i<30?'fact':'experience',d=sample(group,'calibration',`cli${i}`),f=d.families[0];
    f.split=i%30<16?'development':i%30<24?'calibration':'holdout';
    d.queries=evaluation.retrievalCategories.map((category,j)=>({...d.queries[category==='negative'?1:0],id:`cli${i}-${category}`,text:`${category==='negative'?'omega':'alpha beta gamma'} ordinal${i} category${j}`,category}));
    all.push(d);
  }
  return merge(...all);
}
const run=(args:string[])=>spawnSync(process.execPath,['--import','tsx',resolve('scripts/evaluate-memory-retrieval.ts'),...args],{encoding:'utf8'});
it('CLI freezes candidate before paired holdout, records use, reports differences and refuses reuse',()=>{
  const dir=mkdtempSync(join(tmpdir(),'q2-pair-')),dataset=join(dir,'dataset.json'),candidate=join(dir,'candidate.json'),report=join(dir,'report.json');
  writeFileSync(dataset,JSON.stringify(cliDataset()));
  const args=['--dataset',dataset,'--report',report,'--candidate',candidate,'--select-lexical','--splits','holdout'];
  const first=run(args);expect(first.status,first.stderr).toBe(0);
  const output=JSON.parse(readFileSync(report,'utf8')),frozen=readFileSync(candidate);
  expect(output.candidateHash).toBe(hash(frozen));expect(output.datasetHash).toBe(hash(readFileSync(dataset)));
  expect(output.baseline.queries).toHaveLength(72);expect(output.candidate.queries).toHaveLength(72);expect(output.queryDifferences).toHaveLength(72);
  const usage=JSON.parse(readFileSync(dataset+'.holdout-used.json','utf8'));expect(usage).toMatchObject({status:'completed',candidateHash:hash(frozen),datasetHash:output.datasetHash});
  const second=run(['--dataset',dataset,'--report',join(dir,'again.json'),'--candidate',candidate,'--candidate-hash',hash(frozen),'--splits','holdout']);
  expect(second.status).not.toBe(0);expect(second.stderr).toMatch(/holdout.*used/);expect(existsSync(join(dir,'again.json'))).toBe(false);
},30000);
it('CLI rejects output aliases before reading or changing inputs',()=>{
  const dir=mkdtempSync(join(tmpdir(),'q2-alias-')),dataset=join(dir,'input.json');writeFileSync(dataset,'protected');
  for(const [candidate,report] of [[dataset,join(dir,'report.json')],[join(dir,'output.json'),join(dir,'output.json')],[join(dir,'candidate.json'),dataset+'.holdout-used.json']]){
    const result=run(['--dataset',dataset,'--candidate',candidate,'--report',report,'--select-lexical','--splits','holdout']);
    expect(result.status).not.toBe(0);expect(result.stderr).toMatch(/overwrite|alias/);expect(readFileSync(dataset,'utf8')).toBe('protected');
  }
});

it('CLI selection ignores report splits and an invalid frozen hash cannot consume holdout',()=>{
  const dir=mkdtempSync(join(tmpdir(),'q2-select-')),dataset=join(dir,'dataset.json'),candidate=join(dir,'candidate.json'),report=join(dir,'development.json');
  writeFileSync(dataset,JSON.stringify(cliDataset()));
  const selected=run(['--dataset',dataset,'--report',report,'--candidate',candidate,'--select-lexical','--splits','development']);
  expect(selected.status,selected.stderr).toBe(0);
  const frozen=JSON.parse(readFileSync(candidate,'utf8')),output=JSON.parse(readFileSync(report,'utf8'));
  expect(frozen.selection.split).toBe('calibration');expect(frozen.selection.groups.fact.baseline.queryCount).toBe(48);
  expect(frozen.selection.groups.experience.baseline.queryCount).toBe(48);expect(output.queries).toHaveLength(192);
  expect(output.queries.every((q:{split:string})=>q.split==='development')).toBe(true);
  expect(existsSync(dataset+'.holdout-used.json')).toBe(false);
  const rejected=run(['--dataset',dataset,'--report',join(dir,'holdout.json'),'--candidate',candidate,'--candidate-hash','0'.repeat(64),'--splits','holdout']);
  expect(rejected.status).not.toBe(0);expect(rejected.stderr).toMatch(/hash mismatch/);
  expect(existsSync(dataset+'.holdout-used.json')).toBe(false);expect(existsSync(join(dir,'holdout.json'))).toBe(false);
},30000);

it('paired retrieval preserves direct keys, alwaysInclude, archive authorization and expiry',async()=>{
  const d=sample('fact','holdout'),f=d.families[0],storage=new Storage(':memory:'),store=new MemoryStore(storage);
  f.owners[0].key='pin';
  f.owners.push(store.makeOwner({ownerType:'long',ownerId:'expired'},{content:'alpha beta',sourceIds:[],expiresAt:'2026-01-01T00:00:00Z',retainedFrom:'2025-01-01T00:00:00Z'},AT));
  f.owners.push(store.makeOwner({ownerType:'learned',ownerId:'always'},{content:'unrelated unconditional knowledge',sourceIds:[],alwaysInclude:true,learnedKind:'stable_understanding'},AT));storage.close();
  d.queries=['pin gamma','alpha beta','还记得 alpha beta'].map((text,i)=>{
    const request=makeRetrievalRequest(text,AT,'personal_chat');
    return {...d.queries[0],id:`permissions-${i}`,text,permissions:request.permissions,scope:request.scope,includeDetailHistory:request.includeDetailHistory,candidateOwnerKeys:f.owners.map(o=>`${o.ownerType}:${o.ownerId}` as const)};
  });
  const frozen=JSON.stringify({calibration:{lexical:{fact:0.1,experience:0.1},semantic:null},selection:{datasetHash:evaluation.retrievalDatasetHash(d),split:'calibration'}});
  const pair=await evaluation.evaluatePairedHoldout(d,frozen,hash(frozen));
  for(const report of [pair.baseline,pair.candidate]){
    expect(report.queries[0].actualOwnerKeys).toContain('detail:facta');
    expect(report.queries[1].actualOwnerKeys).not.toContain('long:expired');
    expect(report.queries[2].actualOwnerKeys).toContain('long:expired');
    expect(report.queries.map(q=>q.alwaysIncludeOwnerKeys)).toEqual([['learned:always'],['learned:always'],['learned:always']]);
    expect(report.remoteRequests).toBe(0);
  }
  expect(pair.candidate.queries.map(q=>q.request)).toEqual(pair.baseline.queries.map(q=>q.request));
});

it('candidate JSON loads through synthetic settings and the actual runtime calibrationFile protocol',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'q2-settings-')),candidate=join(dir,'candidate.json'),config=join(dir,'settings.json');
  writeFileSync(candidate,JSON.stringify(await evaluation.selectLexicalCalibration(merge(sample(),sample('experience')))));
  writeFileSync(config,JSON.stringify({background:'synthetic',chatExamples:'synthetic',worldSetting:'synthetic',schoolSetting:'synthetic',initialScene:{description:'synthetic'},initialPlan:'synthetic',models:Object.fromEntries(modelRoles.map(role=>[role,{model:'deepseek-flash'}])),memory:{calibrationFile:'candidate.json'}}));
  const settings=loadSettings(config,{}),storage=new Storage(':memory:'),store=new MemoryStore(storage);
  try {
    store.migrate(AT);store.migrateCapacity(AT);
    const runtime=assembleMemory(storage,settings,new ScriptedModels(),{now:()=>AT},()=>{},{QWEN_API_KEY:'synthetic-unused'},store);
    expect(settings.memory.calibrationFile).toBe(candidate);
    expect(runtime.retrieval.configuration().calibration).toEqual({lexical:{fact:2/3,experience:2/3},semantic:null});
    expect(runtime.index.stats.remoteRequests).toBe(0);await runtime.maintenance.stop();
  } finally {storage.close();}
});
