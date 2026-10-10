import {it,expect} from 'vitest';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {setup,narrative,silent,saveInput} from './helpers';import {HdsiApp} from '../src/app';import {IncomingMediaStore} from '../src/input-media/store';import {IncomingAssets,AttachmentResolver} from '../src/input-media/assets';import {IncomingMediaService} from '../src/input-media/service';
it('ordinary narrative waits, pause does not interrupt current authorized image, freeze survives',async()=>{
 const d=setup(),root=mkdtempSync(join(tmpdir(),'hdsi-media-app-'));const store=new IncomingMediaStore(d.storage),assets=new IncomingAssets(store,root,new AttachmentResolver());
 const service=new IncomingMediaService(store,assets,d.models,{enabled:true});const app=new HdsiApp({...d,incomingMedia:service});
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);
 const original=d.models.runModel.bind(d.models);d.models.outputs.incoming_image={description:'狗头表情',visibleText:[],possibleTone:'玩笑',uncertain:false};
 d.models.runModel=async(task,input,options)=>{if(task.name==='narrative'){entered();await gate;}return original(task,input,options);};
 saveInput(d.storage,'m','（图片）');store.register([{id:'a',messageId:'m',order:0,kind:'image',sourceUrl:'data:image/png;base64,iVBORw0KGgoAAAAA'}]);
 try{
 const running=app.runTurn({inputMessageIds:['m'],taskIds:[],triggerKinds:['input']});await started;d.storage.set('runtime',{...d.storage.runtime(),paused:true});release();await running;
 expect(d.models.calls.filter(c=>c.name==='incoming_image')).toHaveLength(1);
 expect(d.models.calls.find(c=>c.name==='narrative')!.input.resources.visualObservations).toHaveLength(0);
 expect(d.models.calls.find(c=>c.name==='personal_chat')!.input.resources.visualObservations).toHaveLength(1);
 expect(d.models.calls.find(c=>c.name==='memory')!.input.resources.visualObservations).toHaveLength(1);
 const turn=d.storage.all('turns')[0];expect(turn.done).toBe(true);expect(turn.visualContext!.entries[0].status).toBe('ready');expect(d.storage.runtime().paused).toBe(true);
 }finally{await service.stop();d.storage.close();rmSync(root,{recursive:true,force:true});}
});
it('sleep does not inspect incoming images',async()=>{
 const d=setup();d.storage.set('character',{...d.storage.character(),sleep:{sleepAt:'2026-10-07T00:00:00Z',wakeAt:'2026-10-08T00:00:00Z'}});
 let calls=0;const app=new HdsiApp({...d,incomingMedia:{prepareForTurn:async()=>{calls++;return [];}} as any});
 saveInput(d.storage,'m','图');await app.runTurn({inputMessageIds:['m'],taskIds:[],triggerKinds:['input']});expect(calls).toBe(0);d.storage.close();
});

it('disabled_visual_input_preserves_confirmed_deferred_image_after_disk_reopen',async()=>{
 const {modern}=await import('./chat-fixture');const {Storage}=await import('../src/storage');const {initialCharacter}=await import('../src/config');const {EnvironmentStore}=await import('../src/environment/store');const {SchoolStore}=await import('../src/school/store');
 const d=modern(),root=mkdtempSync(join(tmpdir(),'hdsi-confirmed-reopen-')),path=join(root,'story.sqlite');d.storage.close();d.storage=new Storage(path);d.storage.set('character',initialCharacter(d.clock.now()));d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:'2099-01-01T00:00:00Z'});
 let service:IncomingMediaService|undefined,downloads=0;const make=(enabled:boolean)=>{const store=new IncomingMediaStore(d.storage);return new IncomingMediaService(store,new IncomingAssets(store,join(root,'assets'),new AttachmentResolver(async()=>{downloads++;throw Error('forbidden download');})),d.models,{enabled});};
 const app=()=>new HdsiApp({...d,chat:undefined,environmentStore:new EnvironmentStore(d.storage),schoolStore:new SchoolStore(d.storage),incomingMedia:service});
 try{d.models.outputs.incoming_image={description:'合成猫图',visibleText:['hello'],possibleTone:null,uncertain:false};saveInput(d.storage,'image','（图片）');new IncomingMediaStore(d.storage).register([{id:'image:0',messageId:'image',order:0,kind:'image',sourceUrl:'data:image/png;base64,iVBORw0KGgoAAAAA'}]);service=make(true);
 await app().runTurn({inputMessageIds:['image'],taskIds:[],triggerKinds:['input']});const first=service.readConfirmedForMessages(['image'])[0];expect(d.storage.all('memories')).toHaveLength(0);await service.stop();d.storage.close();d.storage=new Storage(path);service=make(false);d.clock.advance(60000);
 d.storage.save('tasks','defer',{id:'defer',kind:'check_messages',at:d.clock.now(),status:'pending',description:'重新考虑图片',checkReason:'deferred_reply',messageIds:['image']});d.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'回应图片',draft:'猫猫'},taskChanges:[]};d.models.outputs.expression={parts:[{kind:'text',content:'猫猫'}]};const before=d.models.calls.length;
 await app().runTurn({inputMessageIds:[],taskIds:['defer'],triggerKinds:['check_messages']});const calls=d.models.calls.slice(before);for(const name of ['personal_chat','expression']){const envelope=calls.find(c=>c.name===name)!.input;expect(envelope.resources.visualObservations).toEqual([{ref:first.observationRef,recognizerVersion:first.recognizerVersion,observation:first.observation}]);expect(envelope.resources.messages.find((m:any)=>m.id==='image').visualAttachments[0].observationRef).toBe(first.observationRef);}
 expect(calls.filter(c=>c.name==='incoming_image')).toHaveLength(0);expect(downloads).toBe(0);expect(d.storage.all('turns').find(t=>t.triggerTaskIds.includes('defer'))!.done).toBe(true);
 }finally{await service?.stop();d.storage.close();rmSync(root,{recursive:true,force:true});}
});
