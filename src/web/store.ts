import { randomUUID } from 'node:crypto';
import { Storage } from '../storage';
import type { ModelRunRef,WebSessionSnapshot,WebOperationRequest,WebOperationRecord,WebConfirmedStep,WebModelCheckpoint,WebSearchResponse,WebMaterial,SelfWebReadSource,WebSessionMetrics,WebSearchCounters } from './types';
type Table='web_sessions'|'web_operations'|'web_materials'|'self_web_read_sources';
interface SessionData {ref:ModelRunRef;counters:WebSearchCounters;nextOperationOrdinal:number;checkpoint:WebModelCheckpoint|null;metrics:WebSessionMetrics}
interface MaterialData {runId:string;material:WebMaterial;firstOperationId:string;provided:boolean}
export class WebSearchStore {
  constructor(public readonly storage:Storage){
    for(const table of ['web_sessions','web_operations','web_materials','self_web_read_sources'])storage.prepare(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,data TEXT NOT NULL)`).run();
    storage.prepare("CREATE UNIQUE INDEX IF NOT EXISTS web_stage_identity ON web_sessions(json_extract(data,'$.ref.ownerType'),json_extract(data,'$.ref.ownerId'),json_extract(data,'$.ref.stageKey'))").run();
    for(const table of ['web_operations','web_materials'])storage.prepare(`CREATE INDEX IF NOT EXISTS ${table}_run ON ${table}(json_extract(data,'$.runId'))`).run();
  }
  private get<T>(table:Table,id:string):T|null {const r=this.storage.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);return r?JSON.parse(String(r.data)):null;}
  private put(table:Table,id:string,data:unknown):void {this.storage.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(id,JSON.stringify(data));}
  private session(runId:string):SessionData {const s=this.get<SessionData>('web_sessions',runId);if(!s)throw new Error('unknown web session');return s;}
  openStage(ownerType:ModelRunRef['ownerType'],ownerId:string,stageKey:string,taskName:string):ModelRunRef {
    const row=this.storage.prepare("SELECT data FROM web_sessions WHERE json_extract(data,'$.ref.ownerType')=? AND json_extract(data,'$.ref.ownerId')=? AND json_extract(data,'$.ref.stageKey')=?").get(ownerType,ownerId,stageKey);
    if(row){const data=JSON.parse(String(row.data)) as SessionData;if(data.ref.taskName!==taskName){data.ref.taskName=taskName;this.put('web_sessions',data.ref.runId,data);}return data.ref;}
    const count=this.storage.prepare("SELECT count(*) AS n FROM web_sessions WHERE json_extract(data,'$.ref.ownerType')=? AND json_extract(data,'$.ref.ownerId')=? AND json_extract(data,'$.ref.taskName')=?").get(ownerType,ownerId,taskName)!;
    const ref:ModelRunRef={runId:randomUUID(),ownerType,ownerId,stageKey,taskName,ordinal:Number(count.n)+1};
    this.put('web_sessions',ref.runId,{ref,counters:{successReads:0,failures:0},nextOperationOrdinal:0,checkpoint:null,metrics:{cacheHits:0,providerSearchCalls:0,providerReadCalls:0}} satisfies SessionData);return ref;
  }
  snapshot(runId:string):WebSessionSnapshot {
    const session=this.session(runId),materials=this.materialRows(runId);
    const operations=this.storage.prepare("SELECT data FROM web_operations WHERE json_extract(data,'$.runId')=? ORDER BY rowid").all(runId).map(r=>JSON.parse(String(r.data)) as WebOperationRecord);
    return {...session,materials:materials.map(m=>m.material),providedMaterialIds:materials.filter(m=>m.provided).map(m=>m.material.id),operations,repairCount:session.checkpoint?.repairCount??0,lookupUsed:session.checkpoint?.lookupUsed??false};
  }
  materialRows(runId:string):MaterialData[]{return this.storage.prepare("SELECT data FROM web_materials WHERE json_extract(data,'$.runId')=? ORDER BY rowid").all(runId).map(r=>JSON.parse(String(r.data)));}
  operation(runId:string,id:string):WebOperationRecord {const op=this.get<WebOperationRecord>('web_operations',id);if(!op||op.runId!==runId)throw new Error('unknown web operation');return op;}
  beginOperation(runId:string,request:WebOperationRequest):WebOperationRecord {
    return this.storage.transaction(()=>{const session=this.session(runId),operationId=`${runId}:op:${session.nextOperationOrdinal++}`;
      const record:WebOperationRecord={operationId,runId,request,candidateUrls:request.kind==='read'?[request.url]:null,nextCandidateIndex:0,status:'pending',materialIds:[],failures:[],confirmedSteps:[],response:null};
      this.saveOperation(record);this.put('web_sessions',runId,session);return record;});
  }
  saveOperation(record:WebOperationRecord):void {this.put('web_operations',record.operationId,record);}
  commitStep(runId:string,step:WebConfirmedStep):void {
    this.storage.transaction(()=>{const op=this.operation(runId,step.operationId);if(op.confirmedSteps.includes(step.stepIndex))return;const session=this.session(runId);
      if(step.material){const existing=this.materialRows(runId).find(r=>r.material.url===step.material.url);if(!existing){session.counters.successReads++;this.put('web_materials',`${runId}:${step.material.id}`,{runId,material:step.material,firstOperationId:op.operationId,provided:false} satisfies MaterialData);}const id=existing?.material.id??step.material.id;if(!op.materialIds.includes(id))op.materialIds.push(id);}
      else{session.counters.failures++;op.failures.push({reason:step.reason,...(step.url?{url:step.url}:{})});}
      op.confirmedSteps.push(step.stepIndex);op.nextCandidateIndex=step.nextCandidateIndex;this.saveOperation(op);this.put('web_sessions',runId,session);
    });
  }
  finishOperation(runId:string,id:string,response:WebSearchResponse):void {this.storage.transaction(()=>{const op=this.operation(runId,id);this.saveOperation({...op,status:'done',response});});}
  saveCheckpoint(runId:string,checkpoint:WebModelCheckpoint):void {const session=this.session(runId);this.put('web_sessions',runId,{...session,checkpoint});}
  compactOwnerCheckpoint(ownerType:ModelRunRef['ownerType'],ownerId:string):void {
    this.storage.prepare("UPDATE web_sessions SET data=json_set(data,'$.checkpoint',NULL) WHERE json_extract(data,'$.ref.ownerType')=? AND json_extract(data,'$.ref.ownerId')=?").run(ownerType,ownerId);
  }
  incrementMetric(runId:string,metric:keyof WebSessionMetrics):void {const session=this.session(runId);session.metrics[metric]++;this.put('web_sessions',runId,session);}
  markProvided(runId:string,materialIds:string[]):void {
    this.storage.transaction(()=>{const session=this.session(runId),rows=this.materialRows(runId);if(materialIds.some(id=>!rows.some(r=>r.material.id===id)))throw new Error('unknown provided web material');
      for(const row of rows.filter(r=>materialIds.includes(r.material.id))){this.put('web_materials',`${runId}:${row.material.id}`,{...row,provided:true});
        if(session.ref.ownerType==='turn'&&session.ref.taskName==='personal_life'){
          const id=`${runId}:self-read:${row.material.id}`;
          if(!this.get('self_web_read_sources',id)){const source:SelfWebReadSource={id,turnId:session.ref.ownerId,runId,operationId:row.firstOperationId,materialId:row.material.id,url:row.material.url,readAt:row.material.readAt,sourceKind:'self_web_read',phase:'personal_life'};this.put('self_web_read_sources',id,source);}
        }
      }
    });
  }
  selfReadSources(turnId:string,runId?:string):SelfWebReadSource[]{return this.storage.prepare(`SELECT data FROM self_web_read_sources WHERE json_extract(data,'$.turnId')=?${runId?" AND json_extract(data,'$.runId')=?":''} ORDER BY rowid`).all(...(runId?[turnId,runId]:[turnId])).map(r=>JSON.parse(String(r.data)));}
  operationalStatus(){
    // SQL projects metadata only: status never loads saved inputs, queries or page bodies.
    const sessions=this.storage.prepare("SELECT json_extract(data,'$.ref') AS ref,json_extract(data,'$.counters') AS counters,json_extract(data,'$.metrics') AS metrics FROM web_sessions ORDER BY rowid").all().map(r=>({ref:JSON.parse(String(r.ref)) as ModelRunRef,counters:JSON.parse(String(r.counters)) as WebSearchCounters,metrics:JSON.parse(String(r.metrics)) as WebSessionMetrics}));
    const owners=new Map<string,{ownerType:ModelRunRef['ownerType'];ownerId:string;successReads:number;failures:number;cacheHits:number;providerSearchCalls:number;providerReadCalls:number}>();
    for(const s of sessions){const key=`${s.ref.ownerType}:${s.ref.ownerId}`,row=owners.get(key)??{ownerType:s.ref.ownerType,ownerId:s.ref.ownerId,successReads:0,failures:0,cacheHits:0,providerSearchCalls:0,providerReadCalls:0};for(const k of ['successReads','failures'] as const)row[k]+=s.counters[k];for(const k of ['cacheHits','providerSearchCalls','providerReadCalls'] as const)row[k]+=s.metrics[k];owners.set(key,row);}
    return {sessions,owners:[...owners.values()]};
  }
}
