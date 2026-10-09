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
