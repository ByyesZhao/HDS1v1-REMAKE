import assert from 'node:assert/strict';
import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {MemoryIndex} from '../src/memory/index';
import {MemoryMaintenance} from '../src/memory/maintenance';
import {consolidationTask,auditTask} from '../src/model/contracts';
import {ChatCompletionsTransport,ModelClient} from '../src/model/client';
import {loadSettings,connectionFor} from '../src/settings';
import {initialCharacter} from '../src/config';
import {addMs} from '../src/time';
import type {MemoryCandidate} from '../src/memory/types';
export async function runMemoryCapacityOnlineAcceptance(path:string,configPath:string){
 const settings=loadSettings(configPath),at=new Date().toISOString(),storage=new Storage(path),store=new MemoryStore(storage),clock={now:()=>at};
 storage.set('character',initialCharacter(at));store.migrate(at);store.migrateCapacity(at);storage.set('background',settings.background);
 let requests=0,repairs=0,current='';const transport=new ChatCompletionsTransport(task=>connectionFor(settings,task));
 const client=new ModelClient({complete:async(request,options)=>{requests++;if(request.repair)repairs++;console.log(`online ${current}: ${request.task.name}${request.repair?' repair':''}`);return transport.complete(request,{signal:options?.signal?AbortSignal.any([options.signal,AbortSignal.timeout(300000)]):AbortSignal.timeout(300000)});}});
 const life=new MemoryLifecycle(store),index=new MemoryIndex(store,{model:'isolated-offline-index',embed:async()=>[1,0]},{clock}),maintenance=new MemoryMaintenance(store,life,index,client,{clock});
 const makeLong=(id:string,content:string,source:string,extra:Partial<MemoryCandidate>={})=>store.makeOwner({ownerType:'long',ownerId:id},{content,sourceIds:[source],retainedFrom:at,expiresAt:addMs(at,90*86400000),...extra},at);
 const base=makeLong('same-event','角色下午整理书桌，找到旧书签，感到怀念','sim-same');
 const s1=store.makeOwner({ownerType:'short',ownerId:'s-a'},{content:'她开始整理书桌，归拢纸张；回想上周的读书经历，感到平静。',linkedLongId:base.id,sourceIds:['sim-same'],shortExpiresAt:addMs(at,7*86400000)},at);
 const s2=store.makeOwner({ownerType:'short',ownerId:'s-b'},{content:'同一次整理书桌的后半段，她在纸张下找到上周留下的书签，收进书中；心情有些怀念。',linkedLongId:base.id,sourceIds:['sim-same'],shortExpiresAt:addMs(at,7*86400000)},at);
 const a=makeLong('map-a','角色为一次校内出行自愿画了路线草图，她觉得手绘地图很有趣。','sim-map-a',{totalAwakenings:30});
 const b=makeLong('map-b','另一天，角色去图书馆前再次自己画路线图，因为享受绘图过程。','sim-map-b',{totalAwakenings:3});
 const detail=store.makeOwner({ownerType:'detail',ownerId:'sim-phone'},{key:'character.phone',value:'测试A牌',content:'测试A牌',sourceIds:['sim-phone-a'],effectiveAt:at},at);
 const conflicting=makeLong('phone-evidence','同一测试时点，另一份来源声称角色正在使用测试B牌手机。','sim-phone-b');
 const cases=[{id:'same-event',kind:'consolidation' as const,rows:[s1,s2,base],selected:['s-a','s-b'],context:'这两条是同一次整理书桌的两个阶段，保留真实事件范围、阶段感受和来源；可以merge_short，若认为无需变化允许retain。'},
  {id:'stable-evidence',kind:'consolidation' as const,rows:[a,b],selected:['map-a'],context:'两个独立模拟事件支持角色本人喜欢画路线草图。30／3有效日期是隔离计数夹具；审核是否适合稳定认识，证据不足允许retain。不是现实用户行为或性格。'},
  {id:'detail-conflict',kind:'audit' as const,rows:[detail,conflicting],selected:['sim-phone'],context:'现有正式手机值与同一时点另一来源冲突；仅审核建议，不自动修改正式值，允许retain或report_conflict。'}];
 const reports:any[]=[];
 try{
  for(const scenario of cases){current=scenario.id;for(const row of scenario.rows)store.saveOwner(row);const started=Date.now(),before=requests;
   const task=(scenario.kind==='audit'?auditTask:consolidationTask)(scenario.rows,scenario.selected);
   const units=await client.runModel(task,{kind:scenario.kind,at,cutoff:at,background:settings.background,scenario:scenario.context,selectedIds:scenario.selected,snapshot:scenario.rows},{lookup:null});
   const job={id:scenario.id,kind:scenario.kind,cutoff:at,createdAt:at,status:'ready' as const,snapshot:scenario.rows,selectedIds:scenario.selected,readSet:scenario.rows,result:units,appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null};store.saveJob('memory_maintenance_jobs',job);
   for(let n=0;n<units.length;n++)assert.equal(maintenance.applyOneReady(at),'applied');
   if(scenario.id==='detail-conflict')assert.equal(store.owner(detail)?.value,'测试A牌');
   for(const projection of store.allOwners().filter(r=>r.kind==='learned'&&r.learnedKind==='stable_understanding'))assert((projection.evidenceMemoryIds?.length??0)>=2);
   reports.push({scenario:scenario.id,actions:units.map(u=>u.action),requests:requests-before,elapsedMs:Date.now()-started,contractValid:true});
  }
  const connection=connectionFor(settings,'memory_consolidation');return {model:connection.model,reasoningEffort:connection.reasoningEffort,requestTimeoutMs:300000,requests,repairs,cases:reports,scope:'authorized character background and isolated simulated memory fixtures; no production chat, images, embedding or QQ',backgroundUnchanged:storage.get('background')===settings.background};
 }finally{await maintenance.stop();storage.close();}
}
