import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Storage} from '../../../../../src/storage';
import {MemoryStore} from '../../../../../src/memory/store';
import {MemoryLifecycle} from '../../../../../src/memory/lifecycle';
import {MemoryCapacity} from '../../../../../src/memory/capacity';
import {MemoryCleanup} from '../../../../../src/memory/cleanup';
import {MemoryMaintenance} from '../../../../../src/memory/maintenance';
import {MemoryIndex} from '../../../../../src/memory/index';
import {MemoryIdle} from '../../../../../src/memory/idle';
import {defaultMemoryCapacity, type MemoryCandidate} from '../../../../../src/memory/types';
import {memoryTask} from '../../../../../src/model/contracts';
import {projectOwner} from '../../../../../src/model/context-views';
import {initialCharacter} from '../../../../../src/config';
import type {ModelRunner} from '../../../../../src/types';

const at='2026-10-01T02:00:00.000Z';
const later='2026-10-09T02:00:00.000Z';
const day=(n:number)=>new Date(Date.parse(at)+n*86400000).toISOString();
const outputs:Record<string,unknown>={};
function setup(){
  const db=new Storage(':memory:'),store=new MemoryStore(db);
  db.set('memory_schema_version',3);db.set('character',initialCharacter(at));
  return {db,store};
}
function long(store:MemoryStore,id:string,data:Partial<MemoryCandidate>={}){
  const row=store.makeOwner({ownerType:'long',ownerId:id},{content:'考试事件',retainedFrom:at,expiresAt:day(90),sourceIds:['source'],...data},at);
  store.saveOwner(row);return row;
}
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};

async function main(){
  {
    const {db,store}=setup(),life=new MemoryLifecycle(store);
    const old=long(store,'exam',{happenedAt:at,happenedUntil:at,eventSummary:'参加考试',content:'参加考试\n轻松',feelingSummary:'轻松'});
    const result=memoryTask(['retell'],['exam']).parse({schemaVersion:3,shortTermChanges:[{action:'create',clientRef:'retell',existingLongId:'exam',hasNewEventProgress:false,content:'重新整理那次考试细节',eventSummary:'参加考试',feelingSummary:'轻松',topics:['考试'],sourceIds:['retell'],importance:'normal'}],longTermChanges:[],detailChanges:[]});
    life.apply(result,'retell-turn',later,['retell']);
    const updated=store.canonical(old.id)!;
    assert.equal(updated.lastEventUpdateAt,at);
    assert.equal(updated.happenedAt,at);
    assert.equal(updated.happenedUntil,later);
    assert.equal(updated.expiresAt,old.expiresAt);
    assert.equal(projectOwner(updated,'personal').happenedUntil,later);
    outputs.retalkDates={at:later,hasNewEventProgress:false,omittedOptionalEventTimes:true,before:{happenedAt:old.happenedAt,happenedUntil:old.happenedUntil,lastEventUpdateAt:old.lastEventUpdateAt},after:{happenedAt:updated.happenedAt,happenedUntil:updated.happenedUntil,lastEventUpdateAt:updated.lastEventUpdateAt},personalModelView:projectOwner(updated,'personal')};
    db.close();
  }
  {
    const {db,store}=setup(),clock={now:()=>later},calls:any[]=[];
    const models:ModelRunner={async runModel(task,input){calls.push(input);const ids=(input as any).context.selectedIds as string[];return task.parse({units:ids.map(id=>({unitKey:id,action:'retain',readOwners:[id],ids:[id],sourceIds:[]}))});}};
    for(const id of ['a','b','c']){const row=long(store,id,{content:'正文'.repeat(60)});store.queueDirty(row,'event',at);}
    const index=new MemoryIndex(store,{model:'offline',embed:async()=>[1,0]},{clock});
    const maintenance=new MemoryMaintenance(store,new MemoryLifecycle(store),index,models,{clock,idle:new MemoryIdle(db,15,true),batchItems:20,batchCharacters:150});
    assert.equal(maintenance.startOne(later),true);await flush();
    assert.deepEqual(calls[0].context.selectedIds,['a','b','c']);
    assert.equal(calls[0].resources.owners.reduce((n:number,r:any)=>n+(r.content??r.eventSummary).length,0),360);
    outputs.batchCharacters={configured:150,eachIndependentOwnerCharacters:120,selectedIds:calls[0].context.selectedIds,selectedCharacters:360,dependencyOwners:0,jobStatus:store.jobs<any>('memory_maintenance_jobs')[0].status};
    await maintenance.stop();db.close();
  }
  {
    const results=[];
    for(const history of [0,1000,5000]){
      const {db,store}=setup();
      db.transaction(()=>{
        for(let i=0;i<history;i++)store.saveJob('memory_maintenance_jobs',{id:'completed-'+i,kind:'consolidation',startedAt:at,cutoff:at,createdAt:at,status:'done',snapshot:[],selectedIds:['old-'+i],readSet:[],result:null,appliedUnitKeys:['old-'+i],staleUnitKeys:[],retryAt:null,lastError:null});
        for(let i=0;i<10;i++)long(store,'expired-'+i,{archiveEnteredAt:day(-100)});
      });
      const cleanup=new MemoryCleanup(store,new MemoryCapacity(store,defaultMemoryCapacity));
      const save=store.saveJob.bind(store);let rewrittenDoneJobs=0;
      store.saveJob=((table:any,job:any)=>{if(job.status==='done')rewrittenDoneJobs++;return save(table,job);}) as any;
      const started=performance.now();
      for(let i=0;i<10;i++)assert.equal(cleanup.applyOne(at),'applied');
      const elapsedMs=performance.now()-started;
      assert.equal(rewrittenDoneJobs,history*10);
      results.push({historyCompletedJobs:history,purgedOwners:10,rewrittenDoneJobs,elapsedMs:Number(elapsedMs.toFixed(2))});
      db.close();
    }
    outputs.cleanupCost=results;
  }
  const output=JSON.stringify(outputs,null,2);
  writeFileSync(join(__dirname,process.argv[2]??'reproduction-results.json'),output+'\n');
  console.log(output);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
