import {it,expect,vi} from 'vitest';
import {modern} from './chat-fixture';
import {HdsiApp} from '../src/app';
import {InputBuffer} from '../src/host/input';
import {Scheduler} from '../src/host/scheduler';
import {ModelClient} from '../src/model/client';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
import {narrative,silent,emptyMemory} from './helpers';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {IncomingMediaStore} from '../src/input-media/store';
import {IncomingAssets,AttachmentResolver} from '../src/input-media/assets';
import {IncomingMediaService} from '../src/input-media/service';
import {currentSelfWebReads} from '../src/memory/organize';
async function fixture(){const d=modern(),input=new InputBuffer(d.storage),s=new Scheduler(d.storage);await input.acceptInput({id:'a',content:'old',receivedAt:d.clock.now()});d.clock.advance(15000);const request=(await s.collectReady(d.clock.now()))!;const provider={signature:'offline',search:vi.fn(async()=>[]),read:vi.fn(async()=>({bodyFormat:'text' as const,title:'old page',body:'OLD WEB BODY'}))};return {...d,input,s,request,provider,web:new WebSearchService(new WebSearchStore(d.storage),provider,d.clock,{enabled:true})};}
it('new_generation_starts_without_old_lookup_repair_or_web_payload',async()=>{
 const d=await fixture(),requests:any[]=[];let count=0;
 const models=new ModelClient({complete:async r=>{requests.push(r);if(r.task.name==='narrative'){count++;if(count===1)return {lookupDetails:'old query'};if(count===2)return {webRead:{url:'https://example.test/old'}};if(count===3)return {wrong:true};if(count===4){await d.input.acceptInput({id:'b',content:'latest',receivedAt:d.clock.now()});return narrative;}return narrative;}return r.task.name==='memory'?emptyMemory:silent;}});
 const app=new HdsiApp({...d,models});await app.runTurn(d.request);const old=d.storage.unfinishedTurn()!,oldRef=old.id;expect(old.replyFreshness?.state).toBe('waiting');d.clock.advance(15000);const next=await d.s.collectWaitingContinuation(old.id,d.clock.now());expect(next.kind).toBe('run');if(next.kind==='run')await app.continueWaitingTurn(old.id,next.request,next.scope);
 expect(requests.filter(r=>r.task.name==='narrative')[2].lookupResult).toBeDefined();expect(requests.filter(r=>r.task.name==='narrative')[3].repair).toBeDefined();
 const fresh=requests.filter(r=>r.task.name==='narrative')[4];expect(fresh.lookupResult).toBeUndefined();expect(fresh.repair).toBeUndefined();expect(fresh.webMaterials).toEqual([]);expect(fresh.webResults??[]).toEqual([]);expect(JSON.stringify(fresh)).not.toContain('OLD WEB BODY');const stages=d.storage.prepare('SELECT id FROM web_sessions ORDER BY rowid').all().map(r=>d.web.store.snapshot(String(r.id)));expect(stages.filter(s=>s.ref.taskName==='narrative').map(s=>s.ref.stageKey)).toEqual(['reply:1:narrative:narrative','reply:2:narrative:narrative']);expect(stages[0].counters.successReads).toBe(1);expect(stages[0].checkpoint).toBeNull();expect(d.storage.read('turns',oldRef)!.done).toBe(true);d.storage.close();
});
it('only_final_personal_run_supplies_self_reads',async()=>{
 const d=await fixture();d.storage.save('turns','t',{id:'t',replyFreshness:{version:1,generation:2,scope:'event',inputRevision:1,state:'generating',quietUntil:null,firstAttemptAt:null,personalRunId:'final'}} as any);
 const sources=['old','final'].map(runId=>({id:runId,turnId:'t',runId,phase:'personal_life' as const,sourceKind:'self_web_read' as const,operationId:'op',materialId:'m',url:'https://example.test',readAt:d.clock.now()}));
 const deps={...d,web:undefined,getSelfWebReadSources:()=>sources};expect(currentSelfWebReads(deps,'t')).toEqual([sources[1]]);d.storage.save('turns','t',{...d.storage.read('turns','t')!,replyFreshness:{...d.storage.read('turns','t')!.replyFreshness!,personalRunId:null}});expect(currentSelfWebReads(deps,'t')).toEqual([]);d.storage.close();
});

it('same_generation_restart_keeps_quota_new_business_gets_own_quota',async()=>{
 const d=await fixture();let n=0;const requests:any[]=[];
 const models=new ModelClient({complete:async r=>{requests.push(r);if(r.task.name!=='narrative')return r.task.name==='memory'?emptyMemory:silent;
 n++;if(n===1||n===4)return {webRead:{url:'https://example.test/same'}};if(n===2)throw Error('offline transport failure');if(n===3)await d.input.acceptInput({id:'b',content:'new',receivedAt:d.clock.now()});return narrative;}});
 const app=new HdsiApp({...d,models});await expect(app.runTurn(d.request)).rejects.toThrow('offline transport');const id=d.storage.unfinishedTurn()!.id,ref=d.web.store.openStage('turn',id,'reply:1:narrative:narrative','narrative');expect(d.web.store.snapshot(ref.runId).counters.successReads).toBe(1);d.storage.set('runtime',{...d.storage.runtime(),paused:false});await app.resumeUnfinishedTurn();expect(d.storage.unfinishedTurn()!.replyFreshness?.generation).toBe(1);expect(d.provider.read).toHaveBeenCalledTimes(1);d.clock.advance(15000);const next=await d.s.collectWaitingContinuation(id,d.clock.now());if(next.kind==='run')await app.continueWaitingTurn(id,next.request,next.scope);const ref2=d.web.store.openStage('turn',id,'reply:2:narrative:narrative','narrative');expect(ref2.runId).not.toBe(ref.runId);expect(d.web.store.snapshot(ref2.runId).counters).toEqual({successReads:1,failures:0});expect(d.web.store.snapshot(ref.runId).counters.successReads).toBe(1);expect(d.provider.read).toHaveBeenCalledTimes(1);expect(requests.filter(r=>r.task.name==='narrative')[3].webStatus!.counters).toEqual({successReads:0,failures:0});d.storage.close();
});

it('unknown_and_ready_images_survive_refresh_hidden_from_event_dto',async()=>{
 const d=await fixture(),root=mkdtempSync(join(tmpdir(),'reply-images-'));let calls=0;const store=new IncomingMediaStore(d.storage),assets=new IncomingAssets(store,root,new AttachmentResolver());const media=new IncomingMediaService(store,assets,{runModel:async()=>{calls++;return {description:'cat observation',visibleText:[],possibleTone:null,uncertain:false} as any;}},{enabled:true});
 try{
 store.register([{id:'unknown',messageId:'a',order:0,kind:'image'},{id:'ready',messageId:'a',order:1,kind:'image',sourceUrl:'data:image/png;base64,iVBORw0KGgoAAAAA'}]);
 const run=d.models.runModel.bind(d.models);let appended=false;d.models.runModel=async(t,i,o)=>{const r=await run(t,i,o);if(t.name==='personal_chat'&&!appended){appended=true;await d.input.acceptInput({id:'b',content:'latest',receivedAt:d.clock.now()});}return r;};const app=new HdsiApp({...d,incomingMedia:media});await app.runTurn(d.request);const id=d.storage.unfinishedTurn()!.id;expect(d.storage.read('turns',id)!.visualContext!.entries.map(e=>e.status)).toEqual(['unrecognized','ready']);expect(calls).toBe(1);
 d.storage.save('message_attachments','unknown',{...d.storage.read('message_attachments','unknown')!,confirmedObservationRef:d.storage.read('message_attachments','ready')!.confirmedObservationRef,confirmedRecognizerVersion:d.storage.read('message_attachments','ready')!.confirmedRecognizerVersion});
 d.storage.save('tasks','event',{id:'event',kind:'appointment',at:d.clock.now(),description:'event',status:'pending'});const next=await d.s.collectWaitingContinuation(id,d.clock.now());if(next.kind==='run')await app.continueWaitingTurn(id,next.request,next.scope);const eventDto=d.models.calls.filter(c=>c.name==='personal_chat')[1].input;expect(eventDto.roles.visibleIds).toEqual([]);expect(eventDto.resources.visualObservations).toEqual([]);expect(JSON.stringify(eventDto)).not.toContain('cat observation');expect(d.storage.read('turns',id)!.visualContext!.entries.map(e=>e.status)).toEqual(['unrecognized','ready']);d.clock.advance(15000);await app.runTurn((await d.s.collectReady(d.clock.now()))!);expect(calls).toBe(1);
 }finally{await media.stop();d.storage.close();rmSync(root,{recursive:true,force:true});}
});

it('pending_image_keeps_original_asset_phase_and_checkpoint_across_business_rebind',async()=>{
 const d=await fixture(),root=mkdtempSync(join(tmpdir(),'reply-pending-image-'));const store=new IncomingMediaStore(d.storage),assets=new IncomingAssets(store,root,new AttachmentResolver());let imageRequests=0;
 const imageModels=new ModelClient({complete:async()=>{imageRequests++;if(imageRequests===1)return {webRead:{url:'https://example.test/image-info'}};if(imageRequests===2)throw Error('vision interrupted');return {description:'recognized image',visibleText:[],possibleTone:null,uncertain:false};}});
 const media=new IncomingMediaService(store,assets,imageModels,{enabled:true},d.web),app=new HdsiApp({...d,incomingMedia:media});
 try{store.register([{id:'original',messageId:'a',order:0,kind:'image',sourceUrl:'data:image/png;base64,iVBORw0KGgoAAAAA'}]);await expect(app.runTurn(d.request)).rejects.toThrow('vision interrupted');const id=d.storage.unfinishedTurn()!.id,pending=d.storage.read('turns',id)!.visualContext!.entries[0];expect(pending.status).toBe('pending');const ref=d.web.store.openStage('turn',id,'incoming_image:original','incoming_image');expect(d.web.store.snapshot(ref.runId).counters.successReads).toBe(1);store.register([{id:'new',messageId:'b',order:0,kind:'image',sourceUrl:'data:image/png;base64,iVBORw0KGgoAAAAB'}]);await d.input.acceptInput({id:'b',content:'new image',hasVisualAttachment:true,receivedAt:d.clock.now()});d.storage.save('message_attachments','original',{...d.storage.read('message_attachments','original')!,sourceUrl:'https://invalid.test/changed'});d.storage.set('runtime',{...d.storage.runtime(),paused:false});await app.resumeUnfinishedTurn();expect(d.storage.unfinishedTurn()!.replyFreshness?.state).toBe('waiting');d.clock.advance(15000);const next=await d.s.collectWaitingContinuation(id,d.clock.now());if(next.kind==='run')await app.continueWaitingTurn(id,next.request,next.scope);expect(d.web.store.openStage('turn',id,'incoming_image:original','incoming_image').runId).toBe(ref.runId);expect(d.web.store.snapshot(ref.runId).counters.successReads).toBe(1);expect(d.provider.read).toHaveBeenCalledTimes(1);expect(imageRequests).toBe(4);const dto=d.models.calls.find(c=>c.name==='personal_chat')!.input;expect(dto.resources.visualObservations).toHaveLength(2);expect(d.storage.read('turns',id)!.visualContext!.entries.map(e=>e.status)).toEqual(['ready','ready']);}finally{await media.stop();d.storage.close();rmSync(root,{recursive:true,force:true});}
});
