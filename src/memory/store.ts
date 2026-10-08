import { Storage } from '../storage';
import { addMs, milliseconds, nextDaily } from '../time';
import type { Awakening, IndexJob, MemoryCandidate, MemoryOwnerRef, OwnerVersion, RetentionGrant, RetrievalRequest,MemoryDirtyOwner,MemoryAuditReport } from './types';
import {memoryOwnerData} from './types';

const day=86400_000;
// Keep this expression equivalent to capacity.archiveStart, including natural expiry without a persisted anchor.
export function archiveStartSql(data='data',now='?'):string {return `CASE WHEN json_extract(${data},'$.kind')='long' AND json_extract(${data},'$.status')='active' AND json_extract(${data},'$.mergedInto') IS NULL THEN COALESCE(json_extract(${data},'$.archiveEnteredAt'),json_extract(${data},'$.capacityExitedAt'),CASE WHEN julianday(json_extract(${data},'$.expiresAt'))<=julianday(${now}) THEN json_extract(${data},'$.expiresAt') END) END`;}
export type JobTable='memory_index_jobs'|'memory_maintenance_jobs';
function parse<T>(row: Record<string,unknown>|undefined):T|null { return row ? JSON.parse(String(row.data)) : null; }
export function memoryIndexText(owner:MemoryCandidate):string {
  return owner.ownerType==='detail'?`${owner.key}\n${owner.aliases?.join(' ')??''}\n${owner.value}`:`${owner.content}\n${owner.topics.join(' ')}\n${owner.feelingSummary}\n${owner.projectionBasis?.content??''}`;
}
export class MemoryStore {
  constructor(public readonly storage:Storage) {
    for(const table of ['learned_background','memory_retention_grants','memory_index_jobs','memory_maintenance_jobs','memory_dirty_owners','memory_audit_reports']) storage.prepare(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,data TEXT NOT NULL)`).run();
    storage.prepare('CREATE TABLE IF NOT EXISTS memory_awakenings(canonicalMemoryId TEXT NOT NULL,localDate TEXT NOT NULL,firstEffectiveAt TEXT NOT NULL,turnId TEXT NOT NULL,sourceIds TEXT NOT NULL,PRIMARY KEY(canonicalMemoryId,localDate))').run();
    storage.prepare('CREATE TABLE IF NOT EXISTS memory_index(ownerType TEXT NOT NULL,ownerId TEXT NOT NULL,revision INTEGER NOT NULL,configSignature TEXT NOT NULL,vector BLOB NOT NULL,PRIMARY KEY(ownerType,ownerId,revision,configSignature))').run();
    storage.prepare("CREATE INDEX IF NOT EXISTS memory_v3_visibility ON memories(json_extract(data,'$.kind'),json_extract(data,'$.status'),json_extract(data,'$.expiresAt'),json_extract(data,'$.shortExpiresAt'))").run();
    for(const table of ['memory_index_jobs','memory_maintenance_jobs']) storage.prepare(`CREATE INDEX IF NOT EXISTS ${table}_due ON ${table}(json_extract(data,'$.status'),json_extract(data,'$.retryAt'),json_extract(data,'$.createdAt'))`).run();
  }
  schemaVersion():number {return this.storage.get<number>('memory_schema_version')??2;}
  queueDirty(owner:OwnerVersion,reason:MemoryDirtyOwner['reasons'][number],at:string):void {
    const id=`${owner.ownerType}:${owner.ownerId}`;
    const old=parse<MemoryDirtyOwner>(this.storage.prepare('SELECT data FROM memory_dirty_owners WHERE id=?').get(id));
    if(old?.lastProcessedVersion?.revision===owner.revision&&old.lastProcessedVersion.stateVersion===owner.stateVersion)return;
    if(old&&(old.revision>owner.revision||old.revision===owner.revision&&old.stateVersion>owner.stateVersion))return;
    const same=old?.revision===owner.revision&&old.stateVersion===owner.stateVersion;
    const row:MemoryDirtyOwner={ownerType:owner.ownerType,ownerId:owner.ownerId,revision:owner.revision,stateVersion:owner.stateVersion,queuedAt:old?.queuedAt??at,reasons:[...new Set([...(old?.reasons??[]),reason])],status:same?old!.status:'pending',lastProcessedVersion:old?.lastProcessedVersion??null};
    this.storage.prepare('INSERT OR REPLACE INTO memory_dirty_owners VALUES(?,?)').run(id,JSON.stringify(row));
  }
  dirtyOwners():MemoryDirtyOwner[]{return this.storage.prepare("SELECT data FROM memory_dirty_owners WHERE json_extract(data,'$.status') IN ('pending','reserved') ORDER BY julianday(json_extract(data,'$.queuedAt')),id").all().map(r=>JSON.parse(String(r.data)));}
  reserveDirty(owner:OwnerVersion):void {
    const id=`${owner.ownerType}:${owner.ownerId}`;const row=parse<MemoryDirtyOwner>(this.storage.prepare('SELECT data FROM memory_dirty_owners WHERE id=?').get(id));
    if(row&&row.revision===owner.revision&&row.stateVersion===owner.stateVersion)this.storage.prepare('UPDATE memory_dirty_owners SET data=? WHERE id=?').run(JSON.stringify({...row,status:'reserved'}),id);
  }
  completeDirty(readVersion:OwnerVersion,resultingVersion:OwnerVersion):void {
    const id=`${readVersion.ownerType}:${readVersion.ownerId}`;const row=parse<MemoryDirtyOwner>(this.storage.prepare('SELECT data FROM memory_dirty_owners WHERE id=?').get(id));if(!row)return;
    const same=row.revision===readVersion.revision&&row.stateVersion===readVersion.stateVersion;
    this.storage.prepare('UPDATE memory_dirty_owners SET data=? WHERE id=?').run(JSON.stringify({...row,...(same?{revision:resultingVersion.revision,stateVersion:resultingVersion.stateVersion,status:'done'}:{}),lastProcessedVersion:{revision:resultingVersion.revision,stateVersion:resultingVersion.stateVersion}}),id);
  }
  saveAudit(report:MemoryAuditReport):void {this.storage.prepare('INSERT OR REPLACE INTO memory_audit_reports VALUES(?,?)').run(report.id,JSON.stringify(report));}
  makeOwner(ref:MemoryOwnerRef, data:Partial<MemoryCandidate>&{content:string}, at:string):MemoryCandidate {
    return {id:ref.ownerId,kind:ref.ownerType,...ref,revision:1,stateVersion:1,sourceIds:[],createdAt:at,topics:[],status:'active',mergedInto:null,importance:'normal',eventSummary:data.content,feelingSummary:'',happenedAt:at,happenedUntil:data.happenedAt??at,lastEventUpdateAt:at,shortExpiresAt:null,linkedLongId:null,retainedFrom:null,expiresAt:null,summaryQuality:'preview',totalAwakenings:0,windowAwakenings:0,legacyMentions:0,evaluatedEvidenceVersion:null,consolidatedRevision:null,...data};
  }
  migrate(now:string):void {
    if(this.schemaVersion()===3)return;
    if(this.storage.unfinishedTurn())throw new Error('unfinished legacy turn: finish it before memory migration');
    this.storage.transaction(()=>{
      for(const old of this.storage.all('memories')) {
        const row=this.makeOwner({ownerType:old.kind,ownerId:old.id},{...old,legacyMentions:old.mentions,content:old.content},old.createdAt);
        if(old.kind==='short') {
          row.shortExpiresAt=addMs(old.createdAt,7*day); row.linkedLongId=`${old.id}:long`;
          const start=old.importance==='high'?old.createdAt:row.shortExpiresAt;
          const preview=this.makeOwner({ownerType:'long',ownerId:row.linkedLongId},{content:old.content,eventSummary:old.content,sourceIds:old.sourceIds,topics:old.topics,importance:old.importance,retainedFrom:start,expiresAt:addMs(start,90*day)},old.createdAt);
          this.saveOwner(preview);this.queueIndex(preview,now);this.saveGrant({id:`${preview.id}:initial`,canonicalMemoryId:preview.id,kind:'initial',anchorAt:start,expiresAt:preview.expiresAt!,triggerDates:[]});
        } else {
          row.retainedFrom=now;row.expiresAt=addMs(now,90*day);
          this.saveGrant({id:`${old.id}:migration`,canonicalMemoryId:old.id,kind:'migration',anchorAt:now,expiresAt:row.expiresAt,triggerDates:[]});
        }
        this.saveOwner(row);this.queueIndex(row,now);
      }
      for(const old of this.storage.all('details')){const row=this.makeOwner({ownerType:'detail',ownerId:old.key},{...old,content:old.value},old.effectiveAt);this.saveOwner(row);this.queueIndex(row,now);}
      const overdue=this.storage.prepare("SELECT 1 FROM memories WHERE json_extract(data,'$.kind')='short' AND julianday(json_extract(data,'$.shortExpiresAt')) <= julianday(?) LIMIT 1").get(now);
      this.storage.set('runtime',{...this.storage.runtime(),nextMaintenanceAt:overdue?now:nextDaily(now,['04:30'],'Asia/Shanghai')});
      this.storage.set('memory_schema_version',3);
      this.storage.set('memory_index_rebuild_required',true);
    });
  }
  owner(ref:MemoryOwnerRef):MemoryCandidate|null {
    const table=ref.ownerType==='detail'?'details':ref.ownerType==='learned'?'learned_background':'memories';
    const row=parse<MemoryCandidate>(this.storage.prepare(`SELECT data FROM ${table} WHERE id=?`).get(ref.ownerId));return row?memoryOwnerData(row):null;
  }
  canonical(id:string):MemoryCandidate|null {
    let row=this.owner({ownerType:'long',ownerId:id})??this.owner({ownerType:'learned',ownerId:id});
    if(row?.canonicalMemoryId)row=this.owner({ownerType:'long',ownerId:row.canonicalMemoryId});
    while(row?.mergedInto)row=this.owner({ownerType:'long',ownerId:row.mergedInto});
    return row?.kind==='long'?row:null;
  }
  allOwners():MemoryCandidate[]{return ['memories','details','learned_background'].flatMap(table=>this.storage.prepare(`SELECT data FROM ${table} ORDER BY id`).all().map(r=>memoryOwnerData(JSON.parse(String(r.data)))));}
  archivedLongs(now:string):MemoryCandidate[]{return this.storage.prepare(`SELECT data FROM memories WHERE (${archiveStartSql()}) IS NOT NULL ORDER BY id`).all(now).map(r=>memoryOwnerData(JSON.parse(String(r.data))));}
  saveOwner(owner:MemoryCandidate):void {
    const table=owner.ownerType==='detail'?'details':owner.ownerType==='learned'?'learned_background':'memories';
    const data=memoryOwnerData(owner);
    this.storage.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(owner.ownerId,JSON.stringify(data));
  }
  selectCandidates(request:RetrievalRequest):MemoryCandidate[] {
    if(request.scope==='archive'&&!request.permissions.allowArchive||request.includeDetailHistory&&!request.permissions.allowDetailHistory)throw new Error('retrieval permission denied');
    const archive=request.scope==='archive'; const signature=this.storage.get<string>('memory_embedding_signature')??'';
    const sql=`WITH owners AS (
      SELECT id,data FROM memories WHERE json_extract(data,'$.status') NOT IN ('merged','discarded') AND
      ((json_extract(data,'$.kind')='short' AND json_extract(data,'$.capacityExitedAt') IS NULL AND (? OR julianday(json_extract(data,'$.shortExpiresAt'))>julianday(?))) OR
       (json_extract(data,'$.kind')='long' AND json_extract(data,'$.status')!='durable' AND julianday(json_extract(data,'$.retainedFrom'))<=julianday(?) AND (? OR (${archiveStartSql()}) IS NULL)))
      UNION ALL SELECT id,data FROM details
      UNION ALL SELECT id,data FROM learned_background WHERE json_extract(data,'$.status')='active')
      SELECT o.data,i.vector FROM owners o LEFT JOIN memory_index i ON i.ownerType=json_extract(o.data,'$.ownerType') AND i.ownerId=o.id AND i.revision=json_extract(o.data,'$.revision') AND i.configSignature=?`;
    return this.storage.prepare(sql).all(archive?1:0,request.at,request.at,archive?1:0,request.at,signature).map(row=>{
      const data=memoryOwnerData(JSON.parse(String(row.data)) as MemoryCandidate);
      if(!data.ownerType&&data.key)return this.makeOwner({ownerType:'detail',ownerId:data.key},{...data,content:data.value??''},data.effectiveAt??request.at);
      if(row.vector){const bytes=Uint8Array.from(row.vector as Uint8Array);data.normalizedVector=new Float32Array(bytes.buffer);}return data;
    });
  }
  saveVector(owner:OwnerVersion,signature:string,vector:Float32Array):void {
    this.storage.prepare('INSERT OR REPLACE INTO memory_index(ownerType,ownerId,revision,configSignature,vector) VALUES(?,?,?,?,?)').run(owner.ownerType,owner.ownerId,owner.revision,signature,new Uint8Array(vector.buffer,vector.byteOffset,vector.byteLength));
  }
  queueIndex(owner:MemoryCandidate,now:string,signature=this.storage.get<string>('memory_embedding_signature')??'unconfigured'):void {
    const id=`${owner.ownerType}:${owner.ownerId}:${owner.revision}:${signature}`;
    if(this.job('memory_index_jobs',id))return;
    const text=memoryIndexText(owner);
    const ref:OwnerVersion={ownerType:owner.ownerType,ownerId:owner.ownerId,revision:owner.revision,stateVersion:owner.stateVersion};
    this.saveJob<IndexJob>('memory_index_jobs',{id,owner:ref,text,configSignature:signature,createdAt:now,status:'pending',retryAt:null,completedAt:null,completionReason:null});
  }
  saveGrant(grant:RetentionGrant):void {this.storage.prepare('INSERT INTO memory_retention_grants(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(grant.id,JSON.stringify(grant));}
  listGrants(id:string):RetentionGrant[] {return this.storage.prepare("SELECT data FROM memory_retention_grants WHERE json_extract(data,'$.canonicalMemoryId')=? ORDER BY julianday(json_extract(data,'$.anchorAt')),id").all(id).map(r=>JSON.parse(String(r.data)));}
  listAwakenings(id:string):Awakening[]{return this.storage.prepare('SELECT * FROM memory_awakenings WHERE canonicalMemoryId=? ORDER BY julianday(firstEffectiveAt),localDate').all(id).map(r=>({...r,sourceIds:JSON.parse(String(r.sourceIds))}) as Awakening);}
  saveAwakening(a:Awakening):void {
    const existing=this.listAwakenings(a.canonicalMemoryId).find(r=>r.localDate===a.localDate); const earliest=existing&&milliseconds(existing.firstEffectiveAt)<=milliseconds(a.firstEffectiveAt)?existing:a;
    const sources=[...new Set([...(existing?.sourceIds??[]),...a.sourceIds])];
    this.storage.prepare('INSERT INTO memory_awakenings VALUES(?,?,?,?,?) ON CONFLICT(canonicalMemoryId,localDate) DO UPDATE SET firstEffectiveAt=excluded.firstEffectiveAt,turnId=excluded.turnId,sourceIds=excluded.sourceIds').run(a.canonicalMemoryId,a.localDate,earliest.firstEffectiveAt,earliest.turnId,JSON.stringify(sources));
  }
  saveJob<T extends {id:string}>(table:JobTable,job:T):void {this.storage.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(job.id,JSON.stringify(job));}
  projections(canonicalMemoryId:string):MemoryCandidate[]{return this.storage.prepare("SELECT data FROM learned_background WHERE json_extract(data,'$.canonicalMemoryId')=? AND json_extract(data,'$.status')='active' ORDER BY rowid").all(canonicalMemoryId).map(r=>memoryOwnerData(JSON.parse(String(r.data))));}
  maintenanceCandidates(cutoff:string):MemoryCandidate[]{
    return this.storage.prepare("SELECT data FROM memories WHERE json_extract(data,'$.status')='active' AND ((json_extract(data,'$.kind')='short' AND julianday(json_extract(data,'$.shortExpiresAt'))<=julianday(?) AND (json_extract(data,'$.consolidatedRevision') IS NULL OR json_extract(data,'$.consolidatedRevision')!=json_extract(data,'$.revision'))) OR (json_extract(data,'$.kind')='long' AND julianday(json_extract(data,'$.createdAt'))<=julianday(?) AND json_extract(data,'$.totalAwakenings')>=30 AND (json_extract(data,'$.evaluatedEvidenceVersion') IS NULL OR json_extract(data,'$.evaluatedEvidenceVersion')<json_extract(data,'$.stateVersion')))) ORDER BY julianday(json_extract(data,'$.createdAt')),id").all(cutoff,cutoff).map(r=>memoryOwnerData(JSON.parse(String(r.data))));
  }
  job<T>(table:JobTable,id:string):T|null {return parse<T>(this.storage.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id));}
  jobs<T>(table:JobTable,statuses?:Array<'pending'|'computing'|'ready'|'done'>):T[]{
    const where=statuses?` WHERE json_extract(data,'$.status') IN (${statuses.map(()=>'?').join(',')})`:'';
    return this.storage.prepare(`SELECT data FROM ${table}${where} ORDER BY julianday(json_extract(data,'$.createdAt')),id`).all(...statuses??[]).map(r=>JSON.parse(String(r.data)));
  }
}
