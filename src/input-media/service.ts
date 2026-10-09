import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {IncomingMediaStore} from './store';
import {IncomingAssets,ImageUnavailableError} from './assets';
import {faceObservation,PLATFORM_FACE_VERSION} from './qq-face';
import {observeIncomingImage,INCOMING_IMAGE_RECOGNIZER_VERSION as V} from './observe';
import {phaseOptions} from '../web/phases';
import type {ModelRunner} from '../types';
import type {PreparedAttachment,FrozenAttachment,ObservationRecord,AttachmentRecord} from './types';
import type {WebSearchService} from '../web/service';
export class IncomingMediaService {
 private prefetched=new Set<Promise<unknown>>();private observations=new Map<string,Promise<ObservationRecord>>();private stopped=false;private primed=false;
 constructor(readonly store:IncomingMediaStore,readonly assets:IncomingAssets,private models:ModelRunner,private config:{enabled:boolean;recentSegments?:number},private web?:WebSearchService){}
 async primeStickerObservations(){if(this.primed||!this.config.enabled)return;this.primed=true;for(const sticker of this.store.storage.all('stickers')){await readFile(sticker.path).then(b=>createHash('sha256').update(b).digest('hex')).catch(()=>null);}/* Existing mixed-purpose descriptions are deliberately ineligible. */}
 prefetchForMessages(ids:readonly string[]):void{if(!this.config.enabled||this.stopped)return;for(const a of this.store.forMessages(ids).filter(a=>a.kind!=='native_face'&&!a.assetRef)){const job=this.assets.ensureAsset(a.id).catch(()=>{}).finally(()=>this.prefetched.delete(job));this.prefetched.add(job);}}
 private body(entry:FrozenAttachment):PreparedAttachment|null {
  if(entry.status==='pending')return null;
  if(entry.status==='unrecognized')return {...entry,observation:null};
  const row=entry.observationRef?this.store.storage.read('image_observations',entry.observationRef):null;
  if(!row||row.recognizerVersion!==entry.recognizerVersion)throw Error('frozen image observation missing or incompatible');
  return {...entry,observation:row.observation};
 }
 readFrozenForTurn(id:string):PreparedAttachment[]{return (this.store.storage.read('turns',id)?.visualContext?.entries??[]).flatMap(e=>{const b=this.body(e);return b?[b]:[];});}
 readConfirmedForMessages(ids:readonly string[]):PreparedAttachment[]{return this.store.forMessages(ids).flatMap(a=>{
  if(!a.confirmedObservationRef)return [];const row=this.store.storage.read('image_observations',a.confirmedObservationRef);if(!row||row.recognizerVersion!==a.confirmedRecognizerVersion)throw Error('confirmed image observation missing');
  return [{messageId:a.messageId,attachmentId:a.id,order:a.order,status:'ready',origin:row.origin,observationRef:row.id,recognizerVersion:row.recognizerVersion,observation:row.observation} as PreparedAttachment];
 });}
 private freeze(turnId:string,entry:FrozenAttachment){const turn=this.store.storage.read('turns',turnId);if(!turn)throw Error('missing image turn');const entries=turn.visualContext?.entries??[];const index=entries.findIndex(e=>e.attachmentId===entry.attachmentId);if(index<0)entries.push(entry);else entries[index]=entry;this.store.storage.save('turns',turnId,{...turn,visualContext:{version:1,entries}});}
 async prepareForTurn(turnId:string,ids:readonly string[],signal?:AbortSignal):Promise<PreparedAttachment[]> {
  if(this.stopped)throw Error('incoming media stopped');signal?.throwIfAborted();
  const result:PreparedAttachment[]=[];
  for(const a of this.store.forMessages(ids)){
   signal?.throwIfAborted();
   const frozen=this.store.storage.read('turns',turnId)?.visualContext?.entries.find(e=>e.attachmentId===a.id);
   if(frozen&&frozen.status!=='pending'){result.push(this.body(frozen)!);continue;}
   if(frozen?.status==='pending'&&frozen.recognizerVersion!==V)throw Error('unsupported pending image recognizer version');
   const base={messageId:a.messageId,attachmentId:a.id,order:a.order};
   const face=a.kind==='native_face'?faceObservation(a.faceId):null;
   let row:ObservationRecord|undefined,origin:PreparedAttachment['origin']='vision';
   if(face){row={id:'face:'+a.faceId+':'+PLATFORM_FACE_VERSION,contentHash:null,recognizerVersion:PLATFORM_FACE_VERSION,origin:'platform',observation:face,confirmedAt:new Date().toISOString()};const old=this.store.storage.read('image_observations',row.id);if(old)row=old;origin='platform';}
   else if(a.kind==='native_face'||!this.config.enabled){
    const entry:PreparedAttachment={...base,status:'unrecognized',origin:'unavailable',observationRef:null,recognizerVersion:null,observation:null};this.freeze(turnId,entry);result.push(entry);continue;
   }
   else if(!frozen&&a.confirmedObservationRef){row=this.store.storage.read('image_observations',a.confirmedObservationRef)??undefined;if(!row)throw Error('confirmed image observation missing');origin='cache';}
   else {
    let ref:string;
    try{ref=frozen?.status==='pending'&&frozen.imageAssetRef?frozen.imageAssetRef:await this.assets.ensureAsset(a.id,signal);}
    catch(e){if(!(e instanceof ImageUnavailableError))throw e;this.store.storage.save('message_attachments',a.id,{...this.store.storage.read('message_attachments',a.id)!,downloadStatus:'unavailable'});const entry:PreparedAttachment={...base,status:'unrecognized',origin:'unavailable',observationRef:null,recognizerVersion:null,observation:null};this.freeze(turnId,entry);result.push(entry);continue;}
    const phaseKey=frozen?.status==='pending'?frozen.phaseKey:'incoming_image:'+a.id;
    this.freeze(turnId,{...base,status:'pending',imageAssetRef:ref,phaseKey,recognizerVersion:V});
    // Disk ref is validated even when a previous model/tool checkpoint exists.
    await this.assets.resolveImageAsset(ref);
    const cached=this.store.findObservation(ref,V);if(cached){row=cached;origin='cache';}
    else {let promise=this.observations.get(ref);
     if(!promise){promise=(async()=>{const observation=await observeIncomingImage(this.models,ref,phaseOptions(this.web,'turn',turnId,phaseKey,'incoming_image',{lookup:null,signal}));return {id:ref+':'+V,contentHash:ref,recognizerVersion:V,origin:'vision' as const,observation,confirmedAt:new Date().toISOString()};})();this.observations.set(ref,promise);promise.finally(()=>this.observations.delete(ref)).catch(()=>{});}
     row=await promise;signal?.throwIfAborted();
    }
   }
   const entry:PreparedAttachment={...base,status:'ready',origin,observationRef:row.id,recognizerVersion:row.recognizerVersion,observation:row.observation};
   this.store.storage.transaction(()=>{this.store.saveObservation(row!);const current=this.store.storage.read('message_attachments',a.id)!;this.store.storage.save('message_attachments',a.id,{...current,confirmedObservationRef:row!.id,confirmedRecognizerVersion:row!.recognizerVersion});const {observation,...terminal}=entry;this.freeze(turnId,terminal);});
   result.push(entry);
  }
  return result;
 }
 private protectedAsset(ref:string):boolean {
  const db=this.store.storage;
  const turns=db.unfinishedTurn();if(turns?.visualContext?.entries.some(e=>e.status==='pending'&&e.imageAssetRef===ref))return true;
  const recent=new Set(db.recentChatSnapshot({eligibility:'with_visible_inputs',count:this.config.recentSegments??4,visibleIds:[]}).messages.map(m=>m.id));
  const rows=db.prepare("SELECT data FROM message_attachments WHERE json_extract(data,'$.assetRef')=?").all(ref);
  return rows.some(r=>{const a=JSON.parse(String(r.data)) as AttachmentRecord,m=db.read('messages',a.messageId);if(!m)return false;
   return m.direction==='incoming'&&m.seenTurnId===null||recent.has(m.id)||!!m.sharedActivityId&&m.sharedActivityId===db.runtime().sharedClock?.activityId&&db.runtime().sharedClock?.status==='active'||!!turns&&turns.inputMessageIds.includes(m.id)||!!db.prepare("SELECT 1 FROM tasks WHERE json_extract(data,'$.status')='pending' AND EXISTS(SELECT 1 FROM json_each(json_extract(data,'$.messageIds')) WHERE value=?) LIMIT 1").get(m.id);
  });
 }
 private cleanupCandidate():string|null {
  const db=this.store.storage,turn=db.unfinishedTurn();
  const ids=[...db.recentChatSnapshot({eligibility:'with_visible_inputs',count:this.config.recentSegments??4,visibleIds:[]}).messages.map(m=>m.id),...turn?.inputMessageIds??[]];
  const pending=turn?.visualContext?.entries.flatMap(e=>e.status==='pending'&&e.imageAssetRef?[e.imageAssetRef]:[])??[];
  const clock=db.runtime().sharedClock,activity=clock?.status==='active'?clock.activityId:null;
  const row=db.prepare(`SELECT asset.id FROM image_assets asset
   WHERE json_extract(asset.data,'$.state') IN ('ready','deleting')
    AND asset.id NOT IN (SELECT value FROM json_each(?))
    AND NOT EXISTS (
     SELECT 1 FROM message_attachments a JOIN messages m ON m.id=json_extract(a.data,'$.messageId')
     WHERE json_extract(a.data,'$.assetRef')=asset.id AND (
      (json_extract(m.data,'$.direction')='incoming' AND json_extract(m.data,'$.seenTurnId') IS NULL)
      OR m.id IN (SELECT value FROM json_each(?))
      OR (? IS NOT NULL AND json_extract(m.data,'$.sharedActivityId')=?)
      OR EXISTS(SELECT 1 FROM tasks t,json_each(json_extract(t.data,'$.messageIds')) member WHERE json_extract(t.data,'$.status')='pending' AND member.value=m.id)
     )
    ) LIMIT 1`).get(JSON.stringify(pending),JSON.stringify(ids),activity,activity);
  return row?String(row.id):null;
 }
 async cleanupOne(_now:string):Promise<'applied'|'none'> {
  if(this.stopped)return 'none';
  const ref=this.cleanupCandidate();if(!ref)return 'none';
  return await this.assets.retire(ref,()=>!this.protectedAsset(ref))?'applied':'none';
 }
 async stop(){this.stopped=true;await this.assets.stop();await Promise.allSettled([...this.prefetched,...this.observations.values()]);}
}
