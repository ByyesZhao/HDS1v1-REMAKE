import { isStageModelInput } from '../src/model/context-types';
import { ChatEpisodes as DialogueEpisodes } from '../src/dialogue/chat-episodes';
import { DialogueStore } from '../src/dialogue/store';
import assert from 'node:assert/strict';
import {Storage} from '../src/storage';
import {EnvironmentStore} from '../src/environment/store';
import {SchoolStore} from '../src/school/store';
import {defaultConfig,initialCharacter} from '../src/config';
import {HdsiApp} from '../src/app';
import {SerialHost} from '../src/host/runtime';
import {MemoryStore} from '../src/memory/store';
import {MemoryCapacity} from '../src/memory/capacity';
import {MemoryIdle} from '../src/memory/idle';
import {MemoryCleanup} from '../src/memory/cleanup';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {MemoryIndex} from '../src/memory/index';
import {MemoryMaintenance} from '../src/memory/maintenance';
import {defaultMemoryCapacity,type MemoryCandidate} from '../src/memory/types';
import {WebSearchStore} from '../src/web/store';
import {addMs} from '../src/time';
import type {ModelRunner,ModelTask,OutboxItem} from '../src/types';
export async function runMemoryCapacityAcceptance(path:string){
  let now='2026-10-08T02:00:00.000Z';const clock={now:()=>now},advance=(ms:number)=>{now=addMs(now,ms);};
  const storage=new Storage(path),store=new MemoryStore(storage);storage.set('character',initialCharacter(now));store.migrate(now);store.migrateCapacity(now);
  storage.set('runtime',{...storage.runtime(),nextEnvironmentAt:'2099-01-01T00:00:00Z',nextMaintenanceAt:'2099-01-01T00:00:00Z'});
  const capacity=new MemoryCapacity(store,defaultMemoryCapacity),idle=new MemoryIdle(storage,15,true),cleanup=new MemoryCleanup(store,capacity),lifecycle=new MemoryLifecycle(store,capacity);
  const sent:OutboxItem[]=[],calls:string[]=[];
  const models:ModelRunner={async runModel<T>(task:ModelTask<T>,input:unknown):Promise<T>{
    calls.push(task.name);const i=isStageModelInput(input)?{...input.context,visibleMessages:input.resources.messages.filter(m=>input.roles.visibleIds?.includes(m.id)),snapshot:input.resources.owners}:input as any;let result:any;
    const narrative={experiences:[{happenedAt:i.at,description:'隔离验收：一次共同活动中的阶段经历',relatedEventIds:[]}],currentScene:{description:'隔离活动场景',activity:null},energy:{level:'正常',reason:'正常活动'}};
    if(task.name==='narrative')result=narrative;
    else if(task.name==='narrative_shared')result={...narrative,publicNarration:i.sharedMeta.stepNumber===1?'活动开始，双方进入已约定的场景':'活动已完整结束，回到各自生活',progress:`已完成阶段${i.sharedMeta.stepNumber}`,outline:{goal:'完成隔离共同活动',openThreads:[],endingCondition:'完成两个阶段'},simulatedUserActions:[]};
    else if(task.name==='personal_chat')result={emotions:[],reply:{decision:'none'},taskChanges:[],...(i.visibleMessages.some((m:any)=>m.content==='开始活动')?{sharedChange:{action:'start',mode:'shared_offline',title:'隔离共同活动'}}:{})};
    else if(task.name==='personal_shared')result={emotions:[],reply:{decision:'none'},taskChanges:[],...(i.sharedMeta.stepNumber>=2?{sharedChange:{action:'end'}}:{})};
    else if(task.name==='personal_life')result={emotions:[],innerThought:'休息',contact:{willing:false}};
    else if(task.name==='memory')result={schemaVersion:3,shortTermChanges:[{action:'create',clientRef:'event',content:'隔离活动：详细经过和可记住的阶段细节',eventSummary:'隔离活动经历',feelingSummary:'轻松',topics:['隔离活动'],sourceIds:[i.experiences[0].id],importance:'normal'}],longTermChanges:[],detailChanges:[]};
    else if(task.name==='memory_consolidation'){
      const selected=i.selectedIds as string[],available=i.snapshot as MemoryCandidate[],groups=new Map<string,MemoryCandidate[]>();
      for(const id of selected){const r=available.find(r=>r.id===id)!;const key=r.kind==='short'?r.linkedLongId!:r.kind==='learned'||r.kind==='detail'?r.id:r.id;groups.set(key,[...groups.get(key)??[],r]);}
      result={units:[...groups.entries()].map(([key,rows])=>({unitKey:key,action:'retain',ids:rows.map(r=>r.id),readOwners:rows.map(r=>r.id),sourceIds:[],reason:'隔离合法不变更'}))};
    }else throw Error(`Unexpected acceptance task ${task.name}`);
    return task.parse(result);
  }};
  const index=new MemoryIndex(store,{model:'isolated-offline',embed:async()=>[1,0]},{clock});
  let host:SerialHost;
  const maintenance=new MemoryMaintenance(store,lifecycle,index,models,{clock,idle,onReady:()=>void host.wake()});
  const d={storage,clock,models,config:{...defaultConfig,background:'隔离验收角色',chatExamples:'隔离样例'},random:{next:()=>0.5},environmentStore:new EnvironmentStore(storage),schoolStore:new SchoolStore(storage),memoryStore:store,memoryLifecycle:lifecycle,memoryCapacity:capacity,memoryIdle:idle,memoryCleanup:cleanup,maintenance,
    sender:{async sendItem(item:OutboxItem){sent.push(item);return {platformMessageIds:[`isolated-${sent.length}`]};},async sendError(){}},wait:async(ms:number)=>advance(ms)};
  host=new SerialHost(new HdsiApp(d),{timers:false});
  let opened=true;
  try{
    await host.acceptInput({id:'initial',content:'开始活动',receivedAt:now});advance(15000);await host.wake();
    assert(storage.character().scene.shared);advance(60000);await host.wake();assert.equal(storage.character().scene.shared,null);
    const storyTurns=storage.all('turns').length,sharedEnded=storage.character().scene.mode==='chat';assert.equal(storyTurns,3);
    const idleBlockedBefore15=!idle.eligibility(now).allowed;const before=calls.filter(c=>c==='memory_consolidation').length;advance(14*60000);await host.wake();assert.equal(calls.filter(c=>c==='memory_consolidation').length,before);
    advance(60000);
    for(let n=0;n<60&&(store.dirtyOwners().length||maintenance.inFlight||maintenance.status().pending||maintenance.status().ready);n++){await host.wake();await new Promise<void>(r=>setImmediate(r));}
    assert(calls.includes('memory_consolidation'));
    const makeLong=(id:string,extra:Partial<MemoryCandidate>={})=>{const r=store.makeOwner({ownerType:'long',ownerId:id},{content:`隔离普通摘要-${id}`,sourceIds:[`source-${id}`],retainedFrom:now,expiresAt:addMs(now,90*86400000),...extra},now);store.saveOwner(r);return r;};
    storage.transaction(()=>{for(let n=0;n<1001;n++)makeLong(`pressure-long-${String(n).padStart(4,'0')}`);
    for(let n=0;n<101;n++)store.saveOwner(store.makeOwner({ownerType:'short',ownerId:`pressure-short-${String(n).padStart(3,'0')}`},{content:'隔离详细阶段',shortExpiresAt:addMs(now,7*86400000),linkedLongId:`pressure-long-${String(n).padStart(4,'0')}`},now));
    for(let n=0;n<501;n++)makeLong(`archive-${String(n).padStart(3,'0')}`,{archiveEnteredAt:now});
    const protectedArchive=makeLong('protected-archive',{archiveEnteredAt:addMs(now,-100*86400000)});
    const protector=store.makeOwner({ownerType:'short',ownerId:'protected-short'},{content:'保护短期',linkedLongId:protectedArchive.id,shortExpiresAt:addMs(now,7*86400000),importance:'high'},now);store.saveOwner(protector);
    store.saveOwner(store.makeOwner({ownerType:'detail',ownerId:'phone'},{key:'phone',value:'测试手机',content:'测试手机'},now));
    store.saveOwner(store.makeOwner({ownerType:'learned',ownerId:'fixed-evidence'},{content:'测试稳定认识',canonicalMemoryId:'pressure-long-0900',evidenceMemoryIds:['pressure-long-0900']},now));
    storage.save('school_plans','preserved-school',{id:'preserved-school',title:'保留学校计划'} as any);
    });
    const protectedArchive=store.canonical('protected-archive')!,protector=store.owner({ownerType:'short',ownerId:'protected-short'})!;
    const sentinel='DERIVED_PAYLOAD_PURGE_ACCEPTANCE',gone=makeLong('purged',{content:sentinel,archiveEnteredAt:addMs(now,-100*86400000)}),survivor=makeLong('surviving');
    new DialogueEpisodes(new DialogueStore(storage)).acceptMessage({id:'raw-source',content:sentinel,receivedAt:now,direction:'incoming',platformMessageIds:[],batchId:null,seenTurnId:'previous',turnId:null,outboxSeq:null});
    for(const revision of [1,2])store.saveVector({...gone,revision},'isolated',new Float32Array([1,0]));
    store.queueIndex(gone,now,index.configSignature);store.queueDirty(gone,'event',now);store.saveGrant({id:'unrelated-prefix',canonicalMemoryId:gone.id,kind:'initial',anchorAt:now,expiresAt:addMs(now,90*86400000),triggerDates:[]});store.saveAwakening({canonicalMemoryId:gone.id,localDate:'2026-10-08',firstEffectiveAt:now,turnId:'sim',sourceIds:['sim']});
    store.saveAudit({id:'orphan-report',at:now,readSet:[gone],kind:'learned_revision',reason:'测试建议',sourceIds:['sim']});
    for(const status of ['pending','computing','ready','done'] as const){
      const job={id:`payload-${status}`,kind:'consolidation',createdAt:now,cutoff:now,status,snapshot:[gone,survivor],selectedIds:[gone.id,survivor.id],readSet:[gone,survivor],result:status==='ready'||status==='done'?[gone,survivor].map(r=>({unitKey:r.id,action:'retain',readSet:[r],ids:[r.id],sourceIds:[],content:r.content})):null,appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null};
      // Deliberately emulate old persisted completed payloads, bypassing the new compacting writer.
      storage.prepare('INSERT INTO memory_maintenance_jobs VALUES(?,?)').run(job.id,JSON.stringify(job));
    }
    storage.save('turns','payload-turn',{id:'payload-turn',done:true} as any);storage.save('post_jobs','payload-turn',{turnId:'payload-turn',result:{schemaVersion:3,shortTermChanges:[{content:sentinel}],longTermChanges:[],detailChanges:[]} as any});
    const web=new WebSearchStore(storage),ref=web.openStage('turn','payload-turn','memory','memory');web.saveCheckpoint(ref.runId,{input:sentinel,privateLookupResult:sentinel,repair:{original:sentinel,errors:'test'},repairCount:1,lookupUsed:true,pendingOperationId:null,toolResults:[]});
    let cleaned=0,arrived=false,frontBeforeSecondCleanup=false;const apply=cleanup.applyOne.bind(cleanup);
    cleanup.applyOne=(at)=>{if(cleaned===1)frontBeforeSecondCleanup=!!storage.read('messages','during-cleanup')?.seenTurnId;const result=apply(at);if(result==='applied')cleaned++;return result;};
    await host.stop();
    const secondMaintenance=new MemoryMaintenance(store,lifecycle,index,models,{clock,idle,onReady:()=>void host.wake()});d.maintenance=secondMaintenance;
    host=new SerialHost(new HdsiApp(d),{timers:false,yieldToEvents:async()=>{if(cleaned===1&&!arrived){arrived=true;await host.acceptInput({id:'during-cleanup',content:'普通新对话',receivedAt:now});advance(15000);}}});
    await host.start();assert(frontBeforeSecondCleanup);
    const protectedArchiveSurvived=!!store.owner(protectedArchive);assert(protectedArchiveSurvived);
    const leakedPayloads=['memories','learned_background','memory_index_jobs','memory_maintenance_jobs','memory_dirty_owners','memory_audit_reports','post_jobs','web_sessions'].filter(table=>Number(storage.prepare(`SELECT count(*) n FROM ${table} WHERE data LIKE ?`).get(`%${sentinel}%`)!.n)>0);
    assert.deepEqual(leakedPayloads,[]);assert.equal(storage.prepare('SELECT count(*) n FROM memory_index WHERE ownerId=?').get(gone.id)!.n,0);
    assert.equal(store.listAwakenings(gone.id).length,0);assert.equal(store.listGrants(gone.id).length,0);
    store.saveOwner({...store.owner(protector)!,shortExpiresAt:now});await host.wake();const archiveRemovedAfterUnreference=!store.owner(protectedArchive);assert(archiveRemovedAfterUnreference);
    makeLong('archive-replacement',{archiveEnteredAt:now});store.saveOwner(store.makeOwner({ownerType:'short',ownerId:'short-replacement'},{content:'新的合法测试短期',linkedLongId:'pressure-long-0900',shortExpiresAt:addMs(now,7*86400000)},now));
    await host.wake();const counts=capacity.counts(now);assert.equal(counts.shortActive,100);assert.equal(counts.longOccupied,1000);assert.equal(counts.longArchive,500);
    const rawSourcePreserved=storage.read('messages','raw-source')?.content===sentinel;assert(rawSourcePreserved);assert.equal(store.owner({ownerType:'detail',ownerId:'phone'})?.value,'测试手机');assert(storage.read('school_plans','preserved-school'));assert(store.owner({ownerType:'learned',ownerId:'fixed-evidence'}));
    await host.stop();storage.close();opened=false;
    const reopened=new Storage(path);try{
      const persisted=new MemoryStore(reopened),reopenedCounts=new MemoryCapacity(persisted,defaultMemoryCapacity).counts(now);assert.deepEqual(reopenedCounts,counts);assert.equal(reopened.runtime().memoryCapacityVersion,1);
      return {storyTurns,sharedEnded,idleBlockedBefore15,deepCalls:calls.filter(c=>c==='memory_consolidation').length,counts,reopenedCounts,leakedPayloads,rawSourcePreserved,frontBeforeSecondCleanup,protectedArchiveSurvived,archiveRemovedAfterUnreference,cleanupUnits:cleaned,at:now};
    }finally{reopened.close();}
  }finally{if(opened){await host.stop();storage.close();}}
}

