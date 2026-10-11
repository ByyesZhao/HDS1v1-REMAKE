import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { Storage } from '../src/storage';
import { MemoryStore } from '../src/memory/store';
import { MemoryIndex } from '../src/memory/index';
import { MemoryRetrieval, defaultCalibration, makeRetrievalRequest } from '../src/memory/retrieval';
import * as evaluation from '../scripts/lib/memory-retrieval-evaluation';
import type { RetrievalDatasetV2 } from '../scripts/lib/memory-retrieval-evaluation';

const AT='2026-10-11T10:00:00+08:00';
const provider={baseUrl:'https://synthetic.invalid/v1',model:'mini',dimensions:2,async embed(text:string){return text.startsWith('unrelated')?[0,1]:[1,0];}};
function miniature():RetrievalDatasetV2 {
  const storage=new Storage(':memory:'),store=new MemoryStore(storage);
  const families=(['fact','experience'] as const).map(group=>({
    id:group,group,split:'calibration' as const,
    owners:[store.makeOwner({ownerType:group==='fact'?'detail':'long',ownerId:group},{content:`target ${group}`,key:`key ${group}`,value:'target',aliases:[],sourceIds:[],effectiveAt:AT,retainedFrom:AT,expiresAt:'2027-01-01T00:00:00Z'},AT)],messages:[],turns:[],detailHistory:[],
  }));
  storage.close();
  const queries=families.map(f=>{
    const request=makeRetrievalRequest(`synonym ${f.group}`,AT,'personal_chat');
    return {id:`q-${f.id}`,familyId:f.id,text:request.query,at:AT,phase:request.phase,scope:request.scope,permissions:request.permissions,includeDetailHistory:request.includeDetailHistory,category:'paraphrase' as const,candidateOwnerKeys:[`${f.owners[0].ownerType}:${f.id}` as const],expectedOwnerKeys:[`${f.owners[0].ownerType}:${f.id}` as const],rationale:'Independent miniature known-vector contract.'};
  });
  return {version:2,datasetId:'semantic-mini',at:AT,families,queries};
}
const api=evaluation;
const prepare=(dataset:RetrievalDatasetV2,extra:Partial<Parameters<typeof evaluation.prepareRetrievalVectorPack>[2]>={})=>api.prepareRetrievalVectorPack(dataset,provider,{online:true,...extra});

describe('semantic replay miniature only; not quality evidence',()=>{
  it('rejects_dataset_or_signature_mismatch',async()=>{
    const d=miniature(),pack=await prepare(d);
    const calibration={lexical:{fact:1,experience:1},semantic:{fact:0.5,experience:0.5,configSignature:pack.configSignature}};
    await expect(evaluation.evaluateRetrievalDataset({...d,datasetId:'changed'},calibration,{splits:['calibration'],vectors:pack} as any)).rejects.toThrow(/incomplete.*dataset/i);
    await expect(evaluation.evaluateRetrievalDataset(d,{...calibration,semantic:{...calibration.semantic,configSignature:'wrong'}},{splits:['calibration'],vectors:pack} as any)).rejects.toThrow(/incomplete.*signature/i);
  });
  it('vectors_are_reused_without_network',async()=>{
    const d=miniature(),pack=await prepare(d),options={splits:['calibration'],vectors:pack} as any;
    const calibration={lexical:{fact:1,experience:1},semantic:{fact:0.5,experience:0.5,configSignature:pack.configSignature}};
    const report=await evaluation.evaluateRetrievalDataset(d,calibration,options) as any;
    expect(report.metrics).toMatchObject({TP:2,FP:0,FN:0,queryCount:2});
    expect(report.replayProviderCalls).toBe(2);expect(report.replayNetworkRequests).toBe(0);
    expect(report.collectionNetworkRequests).toBe(4);
    expect((await evaluation.evaluateRetrievalDataset(d,calibration,options)).queries).toEqual(report.queries);
  });
  it('query_missing_vector_is_reported',async()=>{
    const d=miniature(),pack=await prepare(d);delete pack.queries['q-fact'];
    await expect(api.selectSemanticCalibration(d,pack)).rejects.toMatchObject({status:'incomplete',issues:expect.arrayContaining(['query:q-fact:missing'])});
  });
  it('rejects malformed vectors, owner revision/text drift and conflicting duplicate embeddings',async()=>{
    const d=miniature(),pack=await prepare(d);
    for(const mutate of [
      (p:any)=>{p.owners['detail:fact'].revision++;},
      (p:any)=>{p.owners['detail:fact'].textHash='changed';},
      (p:any)=>{p.queries['q-fact'].vector=[0,0];},
      (p:any)=>{p.queries['q-fact'].vector=[1,0,0];},
      (p:any)=>{p.queries['q-fact'].vector=[NaN,0];},
    ]){const broken=structuredClone(pack);mutate(broken);await expect(api.selectSemanticCalibration(d,broken)).rejects.toMatchObject({status:'incomplete'});}
    const duplicate=miniature();duplicate.queries.push({...duplicate.queries[0],id:'same-text'});
    const dupPack=await prepare(duplicate);dupPack.queries['same-text'].vector=[0,1];
    expect(()=>api.validateRetrievalVectorPack(duplicate,dupPack)).toThrow(/conflicting_duplicate_vector/);
  });
  it('uncalibrated_baseline_makes_zero_queries',async()=>{
    const d=miniature(),pack=await prepare(d);
    const report=await evaluation.evaluateRetrievalDataset(d,defaultCalibration,{splits:['calibration'],vectors:pack} as any) as any;
    expect(report.replayProviderCalls).toBe(0);expect(report.queries.every((q:any)=>q.semanticSkipReason==='uncalibrated')).toBe(true);
  });
  it('does not label an arbitrary caller supplied index as proven zero network replay',async()=>{
    const d=miniature(),pack=await prepare(d);
    const report=await evaluation.evaluateRetrievalDataset(d,defaultCalibration,{splits:['calibration'],indexFactory:store=>api.createVectorReplayIndex(store,pack)});
    expect(report.replayNetworkRequests).toBeNull();
  });
  it('empty_or_no_compatible_candidate_still_skips',async()=>{
    const d=miniature(),pack=await prepare(d),storage=new Storage(':memory:'),store=new MemoryStore(storage);
    try {
      const index=api.createVectorReplayIndex(store,pack);
      const retrieval=new MemoryRetrieval(store,index,{}, {lexical:{fact:1,experience:1},semantic:{fact:0.5,experience:0.5,configSignature:pack.configSignature}});
      for(const [text,reason] of [['','empty_query'],['synonym fact','no_compatible_candidate']]){
        await retrieval.buildFrozen(makeRetrievalRequest(text,AT,'personal_chat'),[],[],()=>{});
        expect(retrieval.metrics.semanticSkipReason).toBe(reason);
      }
      expect(index.stats.remoteRequests).toBe(0);expect(index).toBeInstanceOf(MemoryIndex);
    } finally {storage.close();}
  });
  it('plans without requests; resumes by signature and text hash; failures remain incomplete',async()=>{
    const d=miniature();d.queries[1].text=d.queries[0].text;
    const plan=await api.prepareRetrievalVectorPack(d,provider,{online:false});
    expect(plan).toMatchObject({status:'incomplete',collectionNetworkRequests:0,plannedRequests:3});
    const collected=await prepare(d);expect(collected.collectionNetworkRequests).toBe(3);
    const resumed=await prepare(d,{previous:collected});expect(resumed.collectionNetworkRequests).toBe(3);
    const failed=await api.prepareRetrievalVectorPack(d,{...provider,async embed(){throw Error('secret credential should never escape');}},{online:true});
    expect(failed.status).toBe('incomplete');expect(JSON.stringify(failed)).not.toContain('secret credential');
    expect(failed.collectionNetworkRequests).toBe(3);
    await expect(api.selectSemanticCalibration(d,failed)).rejects.toMatchObject({status:'incomplete'});
  });
  it('selects complete Cartesian candidates on calibration and binds pack hash',async()=>{
    const d=miniature(),pack=await prepare(d),selected=await api.selectSemanticCalibration(d,pack);
    expect(selected.calibration.lexical).toEqual({fact:1,experience:1});
    expect(selected.selection.vectorPackHash).toBe(api.retrievalVectorPackHash(pack));
    expect(selected.selection.candidates.some((c:any)=>c.semantic===null)).toBe(true);
    const enabled=selected.selection.candidates.filter((c:any)=>c.semantic!==null);
    const facts=new Set(enabled.map((c:any)=>c.semantic.fact)),experiences=new Set(enabled.map((c:any)=>c.semantic.experience));
    expect(enabled).toHaveLength(facts.size*experiences.size);
    expect(facts.has(1)&&experiences.has(1)).toBe(true);
    expect(enabled.every((c:any)=>c.semantic.configSignature===pack.configSignature&&c.groups.fact.queryCount===1&&c.groups.experience.queryCount===1)).toBe(true);
    expect(selected.calibration.semantic).toEqual({fact:1,experience:1,configSignature:pack.configSignature});
    const noLabels=miniature();noLabels.queries.forEach(q=>{q.expectedOwnerKeys=[];q.category='negative';});
    expect((await api.selectSemanticCalibration(noLabels,await prepare(noLabels))).calibration.semantic).toBeNull();
  });
  it('holdout labels never fit selection and vector drift rejects a frozen candidate',async()=>{
    const d=miniature(),held=structuredClone(d.families[0]);held.id='unseen';held.split='holdout';held.owners[0].id=held.owners[0].ownerId='held';
    d.families.push(held);d.queries.push({...d.queries[0],id:'q-held',familyId:held.id,text:'hidden question',candidateOwnerKeys:['detail:held'],expectedOwnerKeys:['detail:held']});
    const pack=await prepare(d),first=await api.selectSemanticCalibration(d,pack);
    d.queries[2].expectedOwnerKeys=['detail:invalid-label'];
    const changedPack={...pack,datasetHash:evaluation.retrievalDatasetHash(d)},second=await api.selectSemanticCalibration(d,changedPack);
    expect(first.calibration).toEqual(second.calibration);expect(first.selection.candidates).toEqual(second.selection.candidates);
    expect(first.selection.datasetHash).not.toBe(second.selection.datasetHash);
    const bytes=JSON.stringify(second),candidate=evaluation.validateFrozenCandidate(bytes,sha(bytes),evaluation.retrievalDatasetHash(d));
    changedPack.collectionNetworkRequests++;
    expect(()=>api.validateSemanticFrozenCandidate(candidate,d,changedPack)).toThrow(/vector_pack_hash_mismatch/);
  });
  it('resumes only missing unique texts and rejects a changed provider before collection',async()=>{
    const d=miniature();let attempts=0;
    const partial=await api.prepareRetrievalVectorPack(d,{...provider,async embed(text:string){attempts++;if(text==='synonym fact')throw Error('failure');return [1,0];}},{online:true});
    expect(partial).toMatchObject({status:'incomplete',collectionNetworkRequests:4});
    const resumed=await prepare(d,{previous:partial});expect(resumed).toMatchObject({status:'complete',collectionNetworkRequests:5,plannedRequests:1});
    expect(resumed.failures).toHaveLength(1);
    await expect(api.prepareRetrievalVectorPack(d,{...provider,model:'changed',async embed(){attempts++;return [1,0];}},{online:true,previous:partial})).rejects.toThrow(/signature_mismatch/);
    expect(attempts).toBe(4);
  });
  it('checkpoints an attempted request before awaiting its result for interrupted resumes',async()=>{
    const d=miniature(),dir=mkdtempSync(join(tmpdir(),'q3-checkpoint-')),path=join(dir,'pack.json');let observed=0;
    const pack=await api.prepareRetrievalVectorPack(d,{...provider,async embed(){
      const durable=JSON.parse(readFileSync(path,'utf8'));observed++;
      if(durable.collectionNetworkRequests!==observed)throw Error('request count not checkpointed');return [1,0];
    }},{online:true,checkpoint:(current:unknown)=>writeFileSync(path,JSON.stringify(current))});
    expect(pack.status).toBe('complete');expect(observed).toBe(4);
  });
});

function cliDataset():RetrievalDatasetV2 {
  const base=miniature(),d:RetrievalDatasetV2={...base,datasetId:'semantic-cli-mini',families:[],queries:[]};
  for(let i=0;i<60;i++){
    const f=structuredClone(base.families[i<30?0:1]),q=structuredClone(base.queries[i<30?0:1]);
    f.id=`mini${i}`;f.split=i%30<16?'development':i%30<24?'calibration':'holdout';
    f.owners=Array.from({length:4},(_,j)=>({...f.owners[0],id:`o${i}-${j}`,ownerId:`o${i}-${j}`,content:`${j?'unrelated':'target'} owner${i}-${j}`,key:`unique-key-${i}-${j}`,value:`${j?'unrelated':'target'} ${i}-${j}`}));
    d.families.push(f);
    for(const category of evaluation.retrievalCategories){
      const text=`${category==='negative'?'unrelated':'synonym'} question${i} ${category}`,request=makeRetrievalRequest(text,AT,'personal_chat');
      d.queries.push({...q,id:`q${i}-${category}`,familyId:f.id,text,category,permissions:request.permissions,scope:request.scope,includeDetailHistory:request.includeDetailHistory,candidateOwnerKeys:f.owners.map(o=>`${o.ownerType}:${o.ownerId}` as const),expectedOwnerKeys:category==='negative'?[]:[`${f.owners[0].ownerType}:${f.owners[0].ownerId}`]});
    }
  }
  return d;
}
const run=(script:string,args:string[])=>spawnSync(process.execPath,['--import','tsx',resolve(`scripts/${script}.ts`),...args],{encoding:'utf8'});
const sha=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
it('prepare CLI requires explicit paths, dry plans and rejects aliases without changing inputs',()=>{
  const dir=mkdtempSync(join(tmpdir(),'q3-plan-')),dataset=join(dir,'dataset.json'),config=join(dir,'config.json'),output=join(dir,'vectors.json');
  writeFileSync(dataset,JSON.stringify(cliDataset()));
  writeFileSync(config,JSON.stringify({memoryEmbedding:{baseUrl:provider.baseUrl,model:provider.model,dimensions:2,apiKeyEnv:'UNSET_SYNTHETIC_KEY'},database:'must-not-open.sqlite'}));
  const args=['--dataset',dataset,'--config',config,'--output',output];
  const result=run('prepare-memory-retrieval-vectors',args);
  expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toMatchObject({mode:'plan',collectionNetworkRequests:0,status:'incomplete'});
  expect(existsSync(output)).toBe(false);expect(existsSync(join(dir,'must-not-open.sqlite'))).toBe(false);
  const alias=run('prepare-memory-retrieval-vectors',['--dataset',dataset,'--config',config,'--output',config]);
  expect(alias.status).not.toBe(0);expect(alias.stderr).toMatch(/alias|overwrite/);
  expect(run('prepare-memory-retrieval-vectors',['--dataset',dataset,'--output',output]).stderr).toMatch(/required/);
  const missing=run('evaluate-memory-retrieval',['--dataset',dataset,'--vectors',output,'--report',join(dir,'report.json'),'--candidate',join(dir,'candidate.json'),'--select-semantic']);
  expect(missing.stderr).toMatch(/incomplete/);expect(existsSync(join(dir,'candidate.json'))).toBe(false);
});
it('semantic CLI rejects incomplete packs before freeze; binds pack before one paired miniature holdout',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'q3-pair-')),dataset=join(dir,'dataset.json'),vectors=join(dir,'vectors.json'),candidate=join(dir,'candidate.json'),report=join(dir,'report.json');
  writeFileSync(dataset,JSON.stringify(cliDataset()));
  const d=evaluation.loadRetrievalDataset(dataset),pack=await api.prepareRetrievalVectorPack(d,{...provider,async embed(text:string){return text.startsWith('unrelated question')?[0,-1]:text.includes('unrelated')?[0,1]:[1,0];}},{online:true});
  const args=['--dataset',dataset,'--vectors',vectors,'--report',report,'--candidate',candidate,'--select-semantic','--splits','holdout'];
  const missing=structuredClone(pack);delete missing.queries['q0-direct'];writeFileSync(vectors,JSON.stringify(missing));
  const rejected=run('evaluate-memory-retrieval',args);expect(rejected.status).not.toBe(0);expect(rejected.stderr).toMatch(/incomplete/);
  expect(existsSync(candidate)).toBe(false);expect(existsSync(dataset+'.holdout-used.json')).toBe(false);
  writeFileSync(vectors,JSON.stringify(pack));
  const result=run('evaluate-memory-retrieval',args);expect(result.status,result.stderr).toBe(0);
  const output=JSON.parse(readFileSync(report,'utf8')),usage=JSON.parse(readFileSync(dataset+'.holdout-used.json','utf8'));
  expect(output.vectorPackHash).toBe(sha(readFileSync(vectors)));expect(output.candidateHash).toBe(sha(readFileSync(candidate)));
  expect(output.baseline.queries).toHaveLength(72);expect(output.candidate.queries).toHaveLength(72);
  expect(output).toMatchObject({replayNetworkRequests:0,replayProviderCalls:72});
  expect(usage).toMatchObject({status:'completed',vectorPackHash:output.vectorPackHash,candidateHash:output.candidateHash});
  expect(run('evaluate-memory-retrieval',args).stderr).toMatch(/holdout already used/);
  expect(run('evaluate-memory-retrieval',[...args,'--select-lexical']).stderr).toMatch(/mutually exclusive/);
},60000);
