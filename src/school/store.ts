import type {Storage} from '../storage';
import type {SchoolNotice,SchoolPlanItem,SchoolInstance,SchoolEntityRef,SchoolEntitySnapshot} from './types';
export class SchoolStore {
 constructor(readonly storage:Storage){}
 plans(){return this.storage.all('school_plans');}
 items(){return this.storage.all('school_plan_items');}
 instances(){return this.storage.all('school_instances');}
 notices(){return this.storage.all('school_notices');}
 knowledge(){return this.storage.all('school_knowledge');}
 progress(){return this.storage.all('school_progress');}
 weeks(){return this.storage.all('school_weeks');}
 activeNotices():SchoolNotice[]{return this.storage.prepare("SELECT rowid,data FROM school_notices WHERE json_extract(data,'$.status') IN ('scheduled','available') ORDER BY rowid").all().map(r=>JSON.parse(String(r.data)));}
 private byIds<T>(table:'school_plan_items'|'school_instances',ids:readonly string[]):T[]{const unique=[...new Set(ids)],rows:Array<Record<string,any>>=[];for(let i=0;i<unique.length;i+=500){const chunk=unique.slice(i,i+500);rows.push(...this.storage.prepare(`SELECT rowid,data FROM ${table} WHERE id IN (${chunk.map(()=>'?').join(',')}) ORDER BY rowid`).all(...chunk));}return rows.sort((a,b)=>Number(a.rowid)-Number(b.rowid)).map(r=>JSON.parse(String(r.data)) as T);}
 itemsByIds(ids:readonly string[]):SchoolPlanItem[]{return this.byIds('school_plan_items',ids);}
 instancesByIds(ids:readonly string[]):SchoolInstance[]{return this.byIds('school_instances',ids);}
 latestKnownSnapshots(refs:readonly SchoolEntityRef[]):SchoolEntitySnapshot[]{const seen=new Set<string>(),out:SchoolEntitySnapshot[]=[];for(const ref of refs){const key=JSON.stringify([ref.entityKind,ref.entityId]);if(seen.has(key))continue;seen.add(key);const row=this.storage.prepare("SELECT json_extract(data,'$.snapshot') AS snapshot FROM school_knowledge WHERE json_extract(data,'$.snapshot.entityKind')=? AND json_extract(data,'$.snapshot.entityId')=? ORDER BY json_extract(data,'$.snapshot.value.deliveryRevision') DESC,json_extract(data,'$.snapshot.revision') DESC,hdsi_epoch_ms(json_extract(data,'$.acquiredAt')) DESC,rowid DESC LIMIT 1").get(ref.entityKind,ref.entityId);if(row)out.push(JSON.parse(String(row.snapshot)));}return out;}
}
