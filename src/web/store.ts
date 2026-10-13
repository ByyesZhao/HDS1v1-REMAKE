import {ModelRunHistory,archiveAndClearCheckpoints,withModelHistorySavepoint,type CheckpointArchiveReason} from '../model/run-history';
import {systemClock} from '../time';
import {decodeCheckpoint,decodeOperation,hydrateResult,toResultRef} from './persistence';
import {webCheckpointIndex} from '../memory/payload-compaction';
import { randomUUID } from 'node:crypto';
import { Storage } from '../storage';
import type { ModelRunRef,WebSessionSnapshot,WebSessionState,WebMaterialMetadata,WebOperationRequest,WebOperationRecord,WebOperationState,WebConfirmedStep,WebModelCheckpoint,WebSearchResponse,WebMaterial,SelfWebReadSource,WebSessionMetrics,WebSearchCounters,WebOwnerRef,WebStatusSummary } from './types';
type Table='web_sessions'|'web_operations'|'web_materials'|'self_web_read_sources';
interface SessionData {ref:ModelRunRef;counters:WebSearchCounters;nextOperationOrdinal:number;checkpoint:WebModelCheckpoint|null;metrics:WebSessionMetrics}
interface MaterialData {runId:string;material:WebMaterial;firstOperationId:string;provided:boolean}
export class WebSearchStore {
  constructor(public readonly storage:Storage,private history=new ModelRunHistory(storage,systemClock)){
    for(const table of ['web_sessions','web_operations','web_materials','self_web_read_sources'])storage.prepare(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,data TEXT NOT NULL)`).run();
    storage.prepare(webCheckpointIndex).run();
    storage.prepare("CREATE UNIQUE INDEX IF NOT EXISTS web_stage_identity ON web_sessions(json_extract(data,'$.ref.ownerType'),json_extract(data,'$.ref.ownerId'),json_extract(data,'$.ref.stageKey'))").run();
    for(const table of ['web_operations','web_materials'])storage.prepare(`CREATE INDEX IF NOT EXISTS ${table}_run ON ${table}(json_extract(data,'$.runId'))`).run();
    storage.prepare("CREATE INDEX IF NOT EXISTS web_materials_run_url ON web_materials(json_extract(data,'$.runId'),json_extract(data,'$.material.url'))").run();
  }
  private get<T>(table:Table,id:string):T|null {const r=this.storage.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);return r?JSON.parse(String(r.data)):null;}
  private put(table:Table,id:string,data:unknown):void {this.storage.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(id,JSON.stringify(data));}
  private session(runId:string):SessionData {const s=this.get<SessionData>('web_sessions',runId);if(!s)throw new Error('unknown web session');return s;}
  openStage(ownerType:ModelRunRef['ownerType'],ownerId:string,stageKey:string,taskName:string):ModelRunRef {
    const row=this.storage.prepare("SELECT json_extract(data,'$.ref') ref FROM web_sessions WHERE json_extract(data,'$.ref.ownerType')=? AND json_extract(data,'$.ref.ownerId')=? AND json_extract(data,'$.ref.stageKey')=?").get(ownerType,ownerId,stageKey);
    if(row){const ref=JSON.parse(String(row.ref)) as ModelRunRef;if(ref.taskName!==taskName){this.storage.prepare("UPDATE web_sessions SET data=json_set(data,'$.ref.taskName',?) WHERE id=?").run(taskName,ref.runId);ref.taskName=taskName;}return ref;}
    const count=this.storage.prepare("SELECT count(*) AS n FROM web_sessions WHERE json_extract(data,'$.ref.ownerType')=? AND json_extract(data,'$.ref.ownerId')=? AND json_extract(data,'$.ref.taskName')=?").get(ownerType,ownerId,taskName)!;
    const ref:ModelRunRef={runId:randomUUID(),ownerType,ownerId,stageKey,taskName,ordinal:Number(count.n)+1};
    this.put('web_sessions',ref.runId,{ref,counters:{successReads:0,failures:0},nextOperationOrdinal:0,checkpoint:null,metrics:{cacheHits:0,providerSearchCalls:0,providerReadCalls:0}} satisfies SessionData);return ref;
  }
  snapshot(runId:string):WebSessionSnapshot {
    const session=this.session(runId),materials=this.materialRows(runId);
    const operations=this.storage.prepare("SELECT data FROM web_operations WHERE json_extract(data,'$.runId')=? ORDER BY rowid").all(runId).map(r=>{const op=decodeOperation(JSON.parse(String(r.data)));return {...op,response:op.response?hydrateResult(op.response,new Map(materials.map(m=>[m.material.id,m.material]))):null};});
    return {...session,checkpoint:session.checkpoint?decodeCheckpoint(session.checkpoint):null,materials:materials.map(m=>m.material),providedMaterialIds:materials.filter(m=>m.provided).map(m=>m.material.id),operations,repairCount:session.checkpoint?.repairCount??0,lookupUsed:session.checkpoint?.lookupUsed??false};
  }
  state(runId:string):WebSessionState {
    const row=this.storage.prepare("SELECT json_extract(data,'$.ref') ref,json_extract(data,'$.counters') counters,json_extract(data,'$.metrics') metrics,json_extract(data,'$.nextOperationOrdinal') nextOperationOrdinal FROM web_sessions WHERE id=?").get(runId);
    if(!row)throw new Error('unknown web session');
    return {ref:JSON.parse(String(row.ref)),counters:JSON.parse(String(row.counters)),metrics:JSON.parse(String(row.metrics)),nextOperationOrdinal:Number(row.nextOperationOrdinal)};
  }
  checkpoint(runId:string):WebModelCheckpoint|null {
    const row=this.storage.prepare("SELECT json_extract(data,'$.checkpoint') checkpoint FROM web_sessions WHERE id=?").get(runId);
    if(!row)throw new Error('unknown web session');return row.checkpoint===null?null:decodeCheckpoint(JSON.parse(String(row.checkpoint)));
  }
  materialMetadata(runId:string,url?:string):WebMaterialMetadata[] {
    return this.storage.prepare("SELECT json_extract(data,'$.material.id') id,json_extract(data,'$.material.url') url,json_extract(data,'$.material.title') title,json_extract(data,'$.material.readAt') readAt,json_extract(data,'$.material.bodyCharacters') bodyCharacters,json_extract(data,'$.material.selectionMode') selectionMode,json_extract(data,'$.material.sourceKind') sourceKind,json_extract(data,'$.firstOperationId') firstOperationId,json_extract(data,'$.provided') provided FROM web_materials WHERE json_extract(data,'$.runId')=?"+(url===undefined?'':" AND json_extract(data,'$.material.url')=?")+' ORDER BY rowid').all(...(url===undefined?[runId]:[runId,url])).map(row=>({id:String(row.id),url:String(row.url),title:String(row.title),readAt:String(row.readAt),bodyCharacters:Number(row.bodyCharacters),selectionMode:row.selectionMode as WebMaterial['selectionMode'],sourceKind:row.sourceKind as WebMaterial['sourceKind'],firstOperationId:String(row.firstOperationId),provided:!!row.provided}));
  }
  materials(runId:string,ids?:readonly string[]):WebMaterial[] {
    if(ids?.length===0)return [];
    const filter=ids?" AND json_extract(data,'$.material.id') IN ("+ids.map(()=>'?').join(',')+')':'';
    return this.storage.prepare("SELECT json_extract(data,'$.material') material FROM web_materials WHERE json_extract(data,'$.runId')=?"+filter+' ORDER BY rowid').all(runId,...ids??[]).map(row=>JSON.parse(String(row.material)) as WebMaterial);
  }
  materialRows(runId:string):MaterialData[]{return this.storage.prepare("SELECT data FROM web_materials WHERE json_extract(data,'$.runId')=? ORDER BY rowid").all(runId).map(r=>JSON.parse(String(r.data)));}
  operationState(runId:string,id:string):WebOperationState {const op=this.get<WebOperationRecord|WebOperationState>('web_operations',id);if(!op||op.runId!==runId)throw new Error('unknown web operation');return decodeOperation(op);}
  operation(runId:string,id:string):WebOperationRecord {const op=this.operationState(runId,id);try{return {...op,response:op.response?hydrateResult(op.response,new Map(this.materials(runId,op.response.materialIds).map(m=>[m.id,m]))):null};}catch(error){throw Error(`web run ${runId}: ${error instanceof Error?error.message:String(error)}`);}}
  beginOperation(runId:string,request:WebOperationRequest,guard?:()=>void):WebOperationState {
    return this.storage.transaction(()=>{guard?.();const row=this.storage.prepare("UPDATE web_sessions SET data=json_set(data,'$.nextOperationOrdinal',json_extract(data,'$.nextOperationOrdinal')+1) WHERE id=? RETURNING json_extract(data,'$.nextOperationOrdinal')-1 ordinal").get(runId);if(!row)throw new Error('unknown web session');const operationId=`${runId}:op:${Number(row.ordinal)}`;
      const record:WebOperationState={formatVersion:2,operationId,runId,request,candidateUrls:request.kind==='read'?[request.url]:null,nextCandidateIndex:0,status:'pending',materialIds:[],failures:[],confirmedSteps:[],response:null};
      this.saveOperation(record);return record;});
  }
  saveOperation(record:WebOperationState):void {if(record.formatVersion!==2)throw Error("new web operation must use formatVersion 2");this.put('web_operations',record.operationId,record);}
  commitStep(runId:string,step:WebConfirmedStep):void {
    this.storage.transaction(()=>{const op=this.operationState(runId,step.operationId);if(op.confirmedSteps.includes(step.stepIndex))return;
      if(step.material){const existing=this.materialMetadata(runId,step.material.url)[0];if(!existing){this.incrementCounter(runId,'successReads');this.put('web_materials',`${runId}:${step.material.id}`,{runId,material:step.material,firstOperationId:op.operationId,provided:false} satisfies MaterialData);}const id=existing?.id??step.material.id;if(!op.materialIds.includes(id))op.materialIds.push(id);}
      else{this.incrementCounter(runId,'failures');op.failures.push({reason:step.reason,...(step.url?{url:step.url}:{})});}
      op.confirmedSteps.push(step.stepIndex);op.nextCandidateIndex=step.nextCandidateIndex;this.saveOperation(op);
    });
  }
  finishOperation(runId:string,id:string,response:WebSearchResponse):void {this.storage.transaction(()=>{const op=this.operationState(runId,id);this.saveOperation({...op,status:'done',response:toResultRef(response)});});}
  saveCheckpoint(runId:string,checkpoint:WebModelCheckpoint):void {if(checkpoint.formatVersion!==2)throw Error("new web checkpoint must use formatVersion 2");const result=this.storage.prepare("UPDATE web_sessions SET data=json_set(data,'$.checkpoint',json(?)) WHERE id=?").run(JSON.stringify(checkpoint),runId);if(!result.changes)throw new Error('unknown web session');}
  compactStages(ownerType:ModelRunRef['ownerType'],ownerId:string,stageKeys:readonly string[],reason:CheckpointArchiveReason='superseded'):void {
    withModelHistorySavepoint(this.storage,()=>{for(const key of stageKeys)archiveAndClearCheckpoints(this.storage,this.history,"json_extract(data,'$.ref.ownerType')=? AND json_extract(data,'$.ref.ownerId')=? AND json_extract(data,'$.ref.stageKey')=?",[ownerType,ownerId,key],reason);});
  }
  compactOwnerCheckpoint(ownerType:ModelRunRef['ownerType'],ownerId:string,reason:CheckpointArchiveReason='completed'):void {
    archiveAndClearCheckpoints(this.storage,this.history,"json_extract(data,'$.ref.ownerType')=? AND json_extract(data,'$.ref.ownerId')=?",[ownerType,ownerId],reason);
  }
  ownerRunIds(ownerType:ModelRunRef['ownerType'],ownerId:string):string[] {
    return this.storage.prepare("SELECT json_extract(data,'$.ref.runId') runId FROM web_sessions WHERE json_extract(data,'$.ref.ownerType')=? AND json_extract(data,'$.ref.ownerId')=?").all(ownerType,ownerId).map(row=>String(row.runId));
  }
  private incrementCounter(runId:string,counter:keyof WebSearchCounters):void {this.incrementSessionNumber(runId,`$.counters.${counter}`);}
  private incrementSessionNumber(runId:string,path:string):void {const result=this.storage.prepare("UPDATE web_sessions SET data=json_set(data,?,json_extract(data,?)+1) WHERE id=?").run(path,path,runId);if(!result.changes)throw new Error('unknown web session');}
  incrementMetric(runId:string,metric:keyof WebSessionMetrics):void {if(!['cacheHits','providerSearchCalls','providerReadCalls'].includes(metric))throw new Error('unknown web metric');this.incrementSessionNumber(runId,`$.metrics.${metric}`);}
  markProvided(runId:string,materialIds:string[],guard?:()=>void):void {
    this.storage.transaction(()=>{guard?.();const session=this.state(runId),rows=this.materialMetadata(runId);if(materialIds.some(id=>!rows.some(r=>r.id===id)))throw new Error('unknown provided web material');
      for(const row of rows.filter(r=>materialIds.includes(r.id))){this.storage.prepare("UPDATE web_materials SET data=json_set(data,'$.provided',json('true')) WHERE id=?").run(`${runId}:${row.id}`);
        if(session.ref.ownerType==='turn'&&session.ref.taskName==='personal_life'){
          const id=`${runId}:self-read:${row.id}`;
          if(!this.get('self_web_read_sources',id)){const source:SelfWebReadSource={id,turnId:session.ref.ownerId,runId,operationId:row.firstOperationId,materialId:row.id,url:row.url,readAt:row.readAt,sourceKind:'self_web_read',phase:'personal_life'};this.put('self_web_read_sources',id,source);}
        }
      }
    });
  }
  selfReadSources(turnId:string,runId?:string):SelfWebReadSource[]{return this.storage.prepare(`SELECT data FROM self_web_read_sources WHERE json_extract(data,'$.turnId')=?${runId?" AND json_extract(data,'$.runId')=?":''} ORDER BY rowid`).all(...(runId?[turnId,runId]:[turnId])).map(r=>JSON.parse(String(r.data)));}
  statusSummary(currentOwners:readonly WebOwnerRef[]):Omit<WebStatusSummary,'enabled'|'limits'> {
    const stats=this.storage.prepare("SELECT COUNT(*) sessions,COALESCE(SUM(json_extract(data,'$.counters.successReads')),0) successReads,COALESCE(SUM(json_extract(data,'$.counters.failures')),0) failures,COALESCE(SUM(json_extract(data,'$.metrics.cacheHits')),0) cacheHits,COALESCE(SUM(json_extract(data,'$.metrics.providerSearchCalls')),0) providerSearchCalls,COALESCE(SUM(json_extract(data,'$.metrics.providerReadCalls')),0) providerReadCalls FROM web_sessions").get()!;
    const owners=this.storage.prepare("SELECT COUNT(*) n FROM (SELECT 1 FROM web_sessions GROUP BY json_extract(data,'$.ref.ownerType'),json_extract(data,'$.ref.ownerId'))").get()!;
    const unique=[...new Map(currentOwners.map(o=>[JSON.stringify([o.ownerType,o.ownerId]),o])).values()];
    const current=unique.slice(0,3).map(owner=>{
      const count=this.storage.prepare("SELECT COUNT(*) n FROM web_sessions WHERE json_extract(data,'$.ref.ownerType')=? AND json_extract(data,'$.ref.ownerId')=?").get(owner.ownerType,owner.ownerId)!;
      const rows=this.storage.prepare("SELECT json_extract(data,'$.ref') ref,json_extract(data,'$.counters') counters,json_extract(data,'$.metrics') metrics FROM web_sessions WHERE json_extract(data,'$.ref.ownerType')=? AND json_extract(data,'$.ref.ownerId')=? ORDER BY rowid DESC LIMIT 6").all(owner.ownerType,owner.ownerId).reverse();
      const stages=rows.map(r=>{const ref=JSON.parse(String(r.ref)) as ModelRunRef;return {runId:ref.runId,stageKey:ref.stageKey,taskName:ref.taskName,counters:JSON.parse(String(r.counters)),metrics:{cacheHits:0,providerSearchCalls:0,providerReadCalls:0,...JSON.parse(String(r.metrics??'{}'))}};});
      return {...owner,stageCount:Number(count.n),stages,omittedStages:Math.max(0,Number(count.n)-stages.length)};
    });
    return {totals:{sessions:Number(stats.sessions),owners:Number(owners.n),successReads:Number(stats.successReads),failures:Number(stats.failures),cacheHits:Number(stats.cacheHits),providerSearchCalls:Number(stats.providerSearchCalls),providerReadCalls:Number(stats.providerReadCalls)},currentOwners:current,omittedOwners:Math.max(0,unique.length-current.length)};
  }
  operationalStatus(){
    // SQL projects metadata only: status never loads saved inputs, queries or page bodies.
    const sessions=this.storage.prepare("SELECT json_extract(data,'$.ref') AS ref,json_extract(data,'$.counters') AS counters,json_extract(data,'$.metrics') AS metrics FROM web_sessions ORDER BY rowid").all().map(r=>({ref:JSON.parse(String(r.ref)) as ModelRunRef,counters:JSON.parse(String(r.counters)) as WebSearchCounters,metrics:JSON.parse(String(r.metrics)) as WebSessionMetrics}));
    const owners=new Map<string,{ownerType:ModelRunRef['ownerType'];ownerId:string;successReads:number;failures:number;cacheHits:number;providerSearchCalls:number;providerReadCalls:number}>();
    for(const s of sessions){const key=`${s.ref.ownerType}:${s.ref.ownerId}`,row=owners.get(key)??{ownerType:s.ref.ownerType,ownerId:s.ref.ownerId,successReads:0,failures:0,cacheHits:0,providerSearchCalls:0,providerReadCalls:0};for(const k of ['successReads','failures'] as const)row[k]+=s.counters[k];for(const k of ['cacheHits','providerSearchCalls','providerReadCalls'] as const)row[k]+=s.metrics[k];owners.set(key,row);}
    return {sessions,owners:[...owners.values()]};
  }
}
