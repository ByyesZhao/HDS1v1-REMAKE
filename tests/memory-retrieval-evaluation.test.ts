import { readFileSync, writeFileSync, mkdtempSync, existsSync, linkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Storage } from '../src/storage';
import { MemoryStore } from '../src/memory/store';
import { MemoryIndex } from '../src/memory/index';
import { MemoryRetrieval, defaultCalibration, makeRetrievalRequest } from '../src/memory/retrieval';
import { ChatEpisodes } from '../src/dialogue/chat-episodes';
import { DialogueStore } from '../src/dialogue/store';
import {
  evaluateRetrievalDataset, validateRetrievalDataset, loadRetrievalDataset,
  retrievalDatasetHash, buildEvaluationRequest, validateFrozenCandidate,
  type RetrievalDatasetV2, type RetrievalFamilyV2, type RetrievalQueryV2,
} from '../scripts/lib/memory-retrieval-evaluation';

const AT = '2026-10-11T10:00:00+08:00';
const fixture = resolve('tests/fixtures/memory-retrieval-v2.json');
const main = () => loadRetrievalDataset(fixture);
const clone = <T>(v:T):T => structuredClone(v);
function miniature():RetrievalDatasetV2 {
  const storage = new Storage(':memory:');
  const store = new MemoryStore(storage);
  const make = (ownerType:'detail'|'long'|'learned', id:string, data:Parameters<MemoryStore['makeOwner']>[1]) =>
    store.makeOwner({ownerType, ownerId:id}, {sourceIds:['m'], effectiveAt:AT, ...data}, AT);
  const family:RetrievalFamilyV2 = {
    id:'unit', split:'development', group:'fact',
    owners:[
      make('detail','phone',{content:'林溪使用青禾手机',key:'林溪的手机',value:'青禾',aliases:['林溪用的手机']}),
      make('long','expired',{content:'林溪的手机维修经历',retainedFrom:'2026-01-01T00:00:00Z',expiresAt:'2026-01-02T00:00:00Z'}),
      make('learned','always',{content:'生活要规律',alwaysInclude:true,learnedKind:'stable_understanding'}),
      make('detail','other',{content:'林希使用白石手机',key:'林希的手机',value:'白石',aliases:[]}),
    ],
    messages:[{id:'m',content:'林溪告诉我她换了青禾手机。',direction:'incoming',receivedAt:AT,platformMessageIds:[],batchId:'b',seenTurnId:null,turnId:null,outboxSeq:null}],
    turns:[],detailHistory:[],
  };
  storage.close();
  const request = makeRetrievalRequest('林溪的手机是什么',AT,'personal_chat',null,['m']);
  const query:RetrievalQueryV2 = {
    id:'unit-direct',familyId:family.id,text:request.query,phase:request.phase,at:AT,
    permissions:request.permissions,scope:request.scope,includeDetailHistory:request.includeDetailHistory,
    category:'direct',candidateOwnerKeys:family.owners.map(o=>`${o.ownerType}:${o.ownerId}` as const),
    expectedOwnerKeys:['detail:phone'],rationale:'林溪与林希是两个人；仅当前手机事实回答问题。过期维修无当前权限，常驻认识单列。',
  };
  return {version:2,datasetId:'unit-only',at:AT,families:[family],queries:[query]};
}

describe('static benchmark label contract (does not retrieve holdout)',()=>{
  it('family_never_crosses_splits',()=>{
    const d=main(); expect(()=>validateRetrievalDataset(d)).not.toThrow();
    d.families.push({...clone(d.families[0]),split:'holdout'});
    expect(()=>validateRetrievalDataset(d)).toThrow(/duplicate family/);
  });
  it('duplicate_query_id_rejected',()=>{
    const d=main();d.queries[1].id=d.queries[0].id;
    expect(()=>validateRetrievalDataset(d)).toThrow(/duplicate query/);
  });
  it('expected_keys_exist',()=>{
    const d=main();d.queries[0].expectedOwnerKeys=['detail:missing'];
    expect(()=>validateRetrievalDataset(d)).toThrow(/expected.*missing/);
  });
  it('six_query_categories_per_family',()=>{
    const d=main(); expect(d.queries).toHaveLength(360);
    d.queries[1].category=d.queries[0].category;
    expect(()=>validateRetrievalDataset(d)).toThrow(/six.*categor/);
  });
  it('fact_and_experience_stratified',()=>{
    const d=main();expect(d.families).toHaveLength(60);
    for(const group of ['fact','experience'])for(const [split,count] of [['development',16],['calibration',8],['holdout',6]] as const)
      expect(d.families.filter(f=>f.group===group&&f.split===split)).toHaveLength(count);
    d.families[0].split='calibration';expect(()=>validateRetrievalDataset(d)).toThrow(/stratif/);
  });
  it('negative_query_has_empty_expectation',()=>{
    const d=main();const q=d.queries.find(q=>q.category==='negative')!;
    expect(d.queries.filter(q=>q.category==='negative')).toHaveLength(60);
    q.expectedOwnerKeys=[q.candidateOwnerKeys[0]];
    expect(()=>validateRetrievalDataset(d)).toThrow(/negative.*empty/);
  });
  it('requires three distractors and source closure',()=>{
    const d=main();d.queries[0].candidateOwnerKeys=d.queries[0].expectedOwnerKeys;
    expect(()=>validateRetrievalDataset(d)).toThrow(/three distractors/);
    const broken=main();broken.families[0].owners[0].sourceIds=['missing-source'];
    expect(()=>validateRetrievalDataset(broken)).toThrow(/source.*missing/);
  });
  it('retains exact file hash and detects in-memory label changes',()=>{
    const d=main();expect(retrievalDatasetHash(d)).toBe(createHash('sha256').update(readFileSync(fixture)).digest('hex'));
    const old=retrievalDatasetHash(d);d.queries[0].rationale+='修订';expect(retrievalDatasetHash(d)).not.toBe(old);
  });
  it('rejects query text leakage and incomplete typed message seeds',()=>{
    const d=main();d.queries[6].text=d.queries[0].text;
    expect(()=>validateRetrievalDataset(d)).toThrow(/query text.*famil/);
    const broken=main();delete (broken.families[0].messages[0] as Partial<typeof broken.families[0]['messages'][0]>).outboxSeq;
    expect(()=>validateRetrievalDataset(broken)).toThrow(/outboxSeq/);
  });
});

it('evaluation_uses_real_retrieval',async()=>{
  const d=miniature(),report=await evaluateRetrievalDataset(d,defaultCalibration,{splits:['development']});
  const storage=new Storage(':memory:');
  try {
    const store=new MemoryStore(storage);store.migrate(AT);
    const episodes=new ChatEpisodes(new DialogueStore(storage));
    for(const m of d.families[0].messages)episodes.acceptMessage(clone(m));
    for(const o of d.families[0].owners)store.saveOwner(o);
    const c=await new MemoryRetrieval(store,undefined,{},defaultCalibration).build(makeRetrievalRequest(d.queries[0].text,AT,'personal_chat',null,['m']));
    const direct=[...c.details,...c.shortTerm,...c.longTerm,...c.learned].map(o=>`${o.ownerType}:${o.ownerId}`).sort();
    expect(report.queries[0].actualOwnerKeys.slice().sort()).toEqual(direct);
    expect(direct).toEqual(['detail:phone','learned:always']);
    expect(report.metrics).toMatchObject({TP:1,FP:0,FN:0,precision:1,recall:1});
    expect(report.queries[0].alwaysIncludeOwnerKeys).toEqual(['learned:always']);
    expect(report.remoteRequests).toBe(0);expect(report.materializedVectorBytes).toBe(0);
  } finally {storage.close();}
});

it('negative false hits exclude alwaysInclude and null denominators stay null',async()=>{
  const d=miniature();d.queries[0].category='negative';d.queries[0].expectedOwnerKeys=[];
  let r=await evaluateRetrievalDataset(d,defaultCalibration,{splits:['development']});
  expect(r.metrics).toMatchObject({TP:0,FP:1,FN:0,negativeFalseHits:1,precision:0,recall:null,F1:null});
  d.queries[0].text='鲸鱼迁徙路线';
  r=await evaluateRetrievalDataset(d,defaultCalibration,{splits:['development']});
  expect(r.metrics).toMatchObject({TP:0,FP:0,FN:0,negativeFalseHits:0,precision:null,recall:null,F1:null});
  expect(r.queries[0].alwaysIncludeOwnerKeys).toEqual(['learned:always']);
});

it('lookup_does_not_expand_permissions',()=>{
  const q=miniature().queries[0];
  expect(()=>buildEvaluationRequest({...q,scope:'archive'})).toThrow(/permission/);
  expect(()=>buildEvaluationRequest({...q,includeDetailHistory:true})).toThrow(/permission/);
  expect(()=>buildEvaluationRequest({...q,permissions:{...q.permissions,allowArchive:true}})).toThrow(/permission/);
  const authorized={...q,text:'还记得以前林溪的手机吗',scope:'archive' as const,includeDetailHistory:true,permissions:{...q.permissions,allowArchive:true,allowDetailHistory:true}};
  expect(buildEvaluationRequest(authorized)).toMatchObject({scope:'archive',includeDetailHistory:true});
  expect(()=>buildEvaluationRequest({...authorized,phase:'school'})).toThrow(/permission/);
});

it.each(['personal_chat','personal_life','personal_shared'] as const)('memory_context_matches_personal_evidence: %s',async phase=>{
  const d=miniature();d.queries[0].phase=phase;
  const r=(await evaluateRetrievalDataset(d,defaultCalibration,{splits:['development']})).queries[0];
  expect(r.personalEvidence.stage).toBe(phase);
  expect(r.personalEvidence.resources.owners.map(o=>`${o.kind}:${o.id}`).sort()).toEqual(['detail:phone','learned:always']);
  const refs=[...r.personalEvidence.roles.detailRefs??[],...r.personalEvidence.roles.learnedRefs??[]].sort();
  expect(refs).toEqual(r.personalEvidence.resources.owners.map(o=>o.ref).sort());
  expect(r.personalEvidence.ownerKeys).toEqual(r.actualOwnerKeys);
});

it('seeds canonical closure without filtering it out of reported SQL results',async()=>{
  const d=miniature(),f=d.families[0],learned=f.owners.find(o=>o.ownerType==='learned')!;
  learned.alwaysInclude=false;learned.content='林溪的手机';learned.canonicalMemoryId='expired';
  const canonical=f.owners.find(o=>o.ownerType==='long')!;canonical.expiresAt='2027-01-01T00:00:00Z';canonical.content='林溪的手机';
  const q=d.queries[0];q.text='林溪的手机';q.candidateOwnerKeys=['detail:phone','learned:always','detail:other'];
  q.expectedOwnerKeys=['detail:phone','learned:always','long:expired'];
  const r=(await evaluateRetrievalDataset(d,defaultCalibration,{splits:['development']})).queries[0];
  expect(r.seededOwnerKeys).toContain('long:expired');expect(r.actualOwnerKeys).toContain('long:expired');expect(r.TP).toBe(3);
});

it('requires labels for extra closure owners and follows historical owner sources',async()=>{
  const d=miniature(),f=d.families[0],q=d.queries[0];
  f.turns.push({id:'history-turn',inputMessageIds:['m'],triggerTaskIds:[],triggerKinds:['input'],at:AT,completedAt:AT,frozenResult:null,outputComplete:true,done:true,batchIds:['b'],entryMode:'chat'});
  f.detailHistory.push({id:'phone-history',key:'林溪的手机',previousValue:'旧款',newValue:'青禾',effectiveAt:AT,reason:'登记更新',sourceIds:['expired'],turnId:'history-turn'});
  q.candidateOwnerKeys=['detail:phone','detail:other','learned:always'];
  expect(()=>validateRetrievalDataset(d,{benchmarkShape:false})).toThrow(/closure.*label/);
  q.closureDistractorOwnerKeys=['long:expired'];
  const row=(await evaluateRetrievalDataset(d,defaultCalibration,{splits:['development']})).queries[0];
  expect(row.seededOwnerKeys).toContain('long:expired');expect(row.closureDistractorOwnerKeys).toEqual(['long:expired']);
});

it('fresh databases prevent cross-query state and reports are deterministic',async()=>{
  const d=miniature();d.queries.push({...clone(d.queries[0]),id:'second'});
  const r=await evaluateRetrievalDataset(d,defaultCalibration,{splits:['development'],indexFactory:store=>{
    expect(store.storage.get('query-marker')).toBeNull();store.storage.set('query-marker',true);
    return new MemoryIndex(store,{model:'offline',dimensions:2,embed:async()=>[1,0]});
  }});
  expect(r.queries[0].actualOwnerKeys).toEqual(r.queries[1].actualOwnerKeys);
  const a=await evaluateRetrievalDataset(d,defaultCalibration,{splits:['development']});
  const b=await evaluateRetrievalDataset(d,defaultCalibration,{splits:['development']});expect(a).toEqual(b);
});

it('counts actual materialized vectors and provider requests',async()=>{
  const d=miniature(),calibration={lexical:{fact:1,experience:1},semantic:{fact:0.9,experience:0.9,configSignature:JSON.stringify({endpoint:'',model:'offline',dimensions:2,template:'memory-v3-text-2'})}};
  const report=await evaluateRetrievalDataset(d,calibration,{splits:['development'],indexFactory:store=>{
    const index=new MemoryIndex(store,{model:'offline',dimensions:2,embed:async()=>[1,0]});
    for(const owner of store.allOwners())store.saveVector(owner,index.configSignature,new Float32Array([1,0]));return index;
  }});
  expect(report.materializedVectorBytes).toBe(24);expect(report.remoteRequests).toBe(1);
});

it('validates frozen candidate against exact candidate bytes and dataset hash',()=>{
  const d=miniature(),candidate={calibration:defaultCalibration,selection:{datasetHash:retrievalDatasetHash(d),split:'calibration'}};
  const bytes=JSON.stringify(candidate),hash=createHash('sha256').update(bytes).digest('hex');
  expect(validateFrozenCandidate(bytes,hash,retrievalDatasetHash(d))).toEqual(candidate);
  expect(()=>validateFrozenCandidate(bytes,'0'.repeat(64),retrievalDatasetHash(d))).toThrow(/candidate hash/);
  expect(()=>validateFrozenCandidate(bytes,hash,'0'.repeat(64))).toThrow(/dataset hash/);
});

it('CLI requires explicit paths and refuses unfrozen holdout before writing a report',()=>{
  const dir=mkdtempSync(join(tmpdir(),'q1-cli-')),report=join(dir,'report.json');
  const run=(args:string[])=>spawnSync(process.execPath,['--import','tsx',resolve('scripts/evaluate-memory-retrieval.ts'),...args],{encoding:'utf8'});
  expect(run([]).status).not.toBe(0);
  const denied=run(['--dataset',fixture,'--report',report,'--splits','holdout']);
  expect(denied.status).not.toBe(0);expect(denied.stderr).toMatch(/holdout/);expect(existsSync(report)).toBe(false);
  const tiny=join(dir,'tiny.json');writeFileSync(tiny,JSON.stringify(miniature()));
  expect(run(['--dataset',tiny,'--report',report]).status).not.toBe(0);expect(existsSync(report)).toBe(false);
});

it('rejects short and long owner IDs that collide in the physical memories table',async()=>{
  const d=miniature(),long=d.families[0].owners.find(o=>o.ownerType==='long')!;
  d.families[0].owners.push({...clone(long),ownerType:'short',kind:'short',shortExpiresAt:'2027-01-01T00:00:00Z'});
  d.queries[0].candidateOwnerKeys.push('short:expired');
  expect(()=>validateRetrievalDataset(d,{benchmarkShape:false})).toThrow(/physical.*memories.*expired/);
  await expect(evaluateRetrievalDataset(d,defaultCalibration,{splits:['development']})).rejects.toThrow(/physical.*memories.*expired/);
});

it('preserves same ID owners stored in different physical tables',async()=>{
  const d=miniature(),long=d.families[0].owners.find(o=>o.ownerType==='long')!;
  long.id='phone';long.ownerId='phone';long.content='林溪的手机';long.expiresAt='2027-01-01T00:00:00Z';
  const q=d.queries[0];q.text='林溪的手机';q.candidateOwnerKeys=q.candidateOwnerKeys.map(k=>k==='long:expired'?'long:phone':k);q.expectedOwnerKeys.push('long:phone');
  const row=(await evaluateRetrievalDataset(d,defaultCalibration,{splits:['development']})).queries[0];
  expect(row.seededOwnerKeys).toContain('detail:phone');expect(row.seededOwnerKeys).toContain('long:phone');
  expect(row.truePositiveOwnerKeys).toEqual(['detail:phone','long:phone']);expect(row.FN).toBe(0);
});

// Complete, unrelated synthetic benchmark shape: never run the frozen main corpus in CLI unit tests.
function syntheticCliDataset():RetrievalDatasetV2 {
  const d:RetrievalDatasetV2={version:2,datasetId:'unit-cli-only',at:AT,families:[],queries:[]};
  const categories=['direct','conversational','paraphrase','multi_topic','temporal','negative'] as const;
  for(let i=0;i<60;i++){
    const sample=miniature(),f=sample.families[0],q=sample.queries[0],prefix=`cli-${i}:`;
    f.id=`cli-${i}`;f.group=i<30?'fact':'experience';f.split=i%30<16?'development':i%30<24?'calibration':'holdout';
    for(const owner of f.owners){owner.id=prefix+owner.id;owner.ownerId=prefix+owner.ownerId;owner.sourceIds=[prefix+'m'];}
    f.messages[0].id=prefix+'m';d.families.push(f);
    for(const [j,category] of categories.entries())d.queries.push({...clone(q),id:prefix+category,familyId:f.id,text:`第${i}组第${j}问：林溪的手机`,category,candidateOwnerKeys:f.owners.map(o=>`${o.ownerType}:${o.ownerId}` as const),expectedOwnerKeys:category==='negative'?[]:[`detail:${prefix}phone`],permissions:{allowArchive:false,allowDetailHistory:false,visibleSourceIds:[prefix+'m']}});
  }
  return d;
}

it.skipIf(process.platform!=='win32')('CLI rejects Windows case aliases without modifying dataset bytes',()=>{
  const dir=mkdtempSync(join(tmpdir(),'q1-case-alias-')),input=join(dir,'frozen-dataset.json'),bytes=JSON.stringify(syntheticCliDataset());
  writeFileSync(input,bytes);
  const result=spawnSync(process.execPath,['--import','tsx',resolve('scripts/evaluate-memory-retrieval.ts'),'--dataset',input,'--report',input.toUpperCase()],{encoding:'utf8'});
  expect(result.status).not.toBe(0);expect(result.stderr).toMatch(/overwrite an input/);expect(readFileSync(input,'utf8')).toBe(bytes);
});

it('CLI rejects hard-linked input/output aliases without modifying dataset bytes',context=>{
  const dir=mkdtempSync(join(tmpdir(),'q1-hardlink-alias-')),input=join(dir,'frozen-dataset.json'),alias=join(dir,'report-alias.json'),bytes=JSON.stringify(syntheticCliDataset());
  writeFileSync(input,bytes);
  try {linkSync(input,alias);} catch(error){
    if(['EPERM','EACCES','ENOTSUP'].includes((error as NodeJS.ErrnoException).code??'')){context.skip('Host filesystem policy does not permit creating a hard link');return;}
    throw error;
  }
  const result=spawnSync(process.execPath,['--import','tsx',resolve('scripts/evaluate-memory-retrieval.ts'),'--dataset',input,'--report',alias],{encoding:'utf8'});
  expect(result.status).not.toBe(0);expect(result.stderr).toMatch(/overwrite an input/);expect(readFileSync(input,'utf8')).toBe(bytes);
});
