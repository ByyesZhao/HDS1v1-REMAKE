const {Storage}=require('../../../../../lib/storage');
const {MemoryStore}=require('../../../../../lib/memory/store');
const {MemoryLifecycle}=require('../../../../../lib/memory/lifecycle');
const {MemoryRetrieval,makeRetrievalRequest}=require('../../../../../lib/memory/retrieval');
const {ContextBuilder}=require('../../../../../lib/memory/context');
const {memoryTask}=require('../../../../../lib/model/contracts');
const {stageInput}=require('../../../../../lib/model/context-views');
const {ModelClient}=require('../../../../../lib/model/client');
const {organizeMemory}=require('../../../../../lib/memory/organize');
const {defaultConfig,initialCharacter}=require('../../../../../lib/config');
// Synthetic fixture only. No files, credentials, real story data or network are read.
(async()=>{
 const at='2026-10-13T04:00:00.000Z',db=new Storage(':memory:');
 try{
  const store=new MemoryStore(db),life=new MemoryLifecycle(store),query='算例口径复核';
  const long=store.makeOwner({ownerType:'long',ownerId:'preview-L'},{content:query,eventSummary:query,topics:[query],sourceIds:['old-source'],retainedFrom:'2026-10-19T04:00:00.000Z',expiresAt:'2027-01-17T04:00:00.000Z'},'2026-10-12T04:00:00.000Z');
  const short=store.makeOwner({ownerType:'short',ownerId:'short-S'},{content:query,eventSummary:query,topics:[query],sourceIds:['old-source'],shortExpiresAt:'2026-10-19T04:00:00.000Z',linkedLongId:long.id},long.createdAt);
  store.saveOwner(long);store.saveOwner(short);db.set('character',initialCharacter(at));
  const retrieval=new MemoryRetrieval(store),context=await new ContextBuilder(db,retrieval).buildForMemory(makeRetrievalRequest(query,at,'memory',null,['new-source']));
  const shortIds=context.retrieved.filter(r=>r.ownerType==='short').map(r=>r.id),directLongIds=context.retrieved.filter(r=>r.ownerType==='long'||r.ownerType==='learned').map(r=>r.id);
  const payload={schemaVersion:3,shortTermChanges:[{action:'create',clientRef:'revisit',existingLongId:long.id,hasNewEventProgress:false,content:query,eventSummary:query,feelingSummary:'平静',topics:[query],sourceIds:['new-source'],importance:'normal'}],longTermChanges:[],detailChanges:[]};
  const parse=(allowed,value)=>{try{memoryTask(['new-source'],allowed,shortIds).parse(value);return {accepted:true};}catch(e){return {accepted:false,error:e.message};}};
  const before=structuredClone(store.canonical(long.id));
  const d={storage:db,retrieval,config:defaultConfig,models:new ModelClient({complete:async()=>payload},undefined,0)};
  const turn={id:'synthetic-turn',at,inputMessageIds:[],triggerTaskIds:[],triggerKinds:['sleep'],batchIds:[],entryMode:'chat',dialogueWindowVersion:2,activityContext:null,outputComplete:true,done:false,frozenResult:{visibleMessageIds:[],reconsiderMessageIds:[],experiences:[{id:'new-source',happenedAt:at,description:query,relatedEventIds:[]}],nextState:db.character(),taskChanges:[],schoolObservations:[],personal:null}};
  let actual;try{await organizeMemory(d,turn);actual={accepted:true};}catch(e){actual={accepted:false,error:e.message};}
  const view=stageInput('memory',{retrieved:context.retrieved});
  const allowedLinkProbe=parse([...directLongIds,long.id],payload),fake=structuredClone(payload);fake.shortTermChanges[0].existingLongId='unprovided-ID';
  life.apply(memoryTask(['new-source'],[...directLongIds,long.id],shortIds).parse(payload),'probe-apply',at,['new-source']);
  const after=store.canonical(long.id);
  const report={fixture:'synthetic',currentOrganizeMemory:actual,bugReproduced:!actual.accepted&&actual.error.includes('existingLongId'),providedKinds:context.retrieved.map(r=>r.kind),directLongIds,transferredLinkedId:view.resources.owners.find(r=>r.id===short.id)?.linkedLongId,relatedIdOnlyProbe:allowedLinkProbe,inventedIdProbe:parse([...directLongIds,long.id],fake),application:{linkedToOriginal:store.owner({ownerType:'short',ownerId:'probe-apply:short:0'}).linkedLongId===long.id,separateLongCreated:!!store.owner({ownerType:'long',ownerId:'probe-apply:short:0:long'}),retentionUnchanged:before.retainedFrom===after.retainedFrom&&before.expiresAt===after.expiresAt,progressTimeUnchanged:before.lastEventUpdateAt===after.lastEventUpdateAt,awakeningsUnchanged:before.totalAwakenings===after.totalAwakenings},productionDatabaseOpened:false,networkRequests:0};
  console.log(JSON.stringify(report,null,2));
  if(!shortIds.includes(short.id)||directLongIds.length||report.transferredLinkedId!==long.id||!allowedLinkProbe.accepted||report.inventedIdProbe.accepted||!report.application.linkedToOriginal||report.application.separateLongCreated||!report.application.retentionUnchanged||!report.application.progressTimeUnchanged||!report.application.awakeningsUnchanged)process.exitCode=1;
 }finally{db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});

