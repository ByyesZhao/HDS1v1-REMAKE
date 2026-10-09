import {it,expect} from 'vitest';
import {setup} from './helpers';
import {HdsiApp} from '../src/app';
import {SerialHost} from '../src/host/runtime';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
it('status grows by at most 64 characters from 10 to 1000 historical turns',async()=>{
 const lengths:number[]=[];
 for(const n of [10,100,1000]){const d=setup(),store=new WebSearchStore(d.storage),web=new WebSearchService(store,undefined,d.clock);
 for(let i=0;i<n;i++)for(let stage=0;stage<4;stage++)store.openStage('turn','t'+i,'stage'+stage,'task');
 const before=d.storage.prepare('SELECT data FROM web_sessions ORDER BY rowid').all();
 const host=new SerialHost(new HdsiApp({...d,web}),{timers:false});
 const text=await host.status();lengths.push(text.slice(text.indexOf('；网页')).length);
 expect(d.storage.prepare('SELECT data FROM web_sessions ORDER BY rowid').all()).toEqual(before);
 expect(text).not.toContain('checkpoint');d.storage.close();}
 expect(lengths[2]-lengths[0]).toBeLessThanOrEqual(64);expect(Math.max(...lengths)).toBeLessThanOrEqual(2048);
});
it('summary returns exact totals and only six recent stages for each of at most three owners',()=>{
 const d=setup(),store=new WebSearchStore(d.storage);
 for(let i=0;i<5;i++)for(let j=0;j<10;j++)store.openStage('turn','t'+i,'s'+j,'task');
 const r=store.statusSummary(Array.from({length:5},(_,i)=>({ownerType:'turn' as const,ownerId:'t'+i})));
 expect(r.totals).toMatchObject({sessions:50,owners:5,successReads:0,failures:0});
 expect(r.currentOwners).toHaveLength(3);expect(r.currentOwners[0].stages).toHaveLength(6);expect(r.currentOwners[0].omittedStages).toBe(4);expect(r.omittedOwners).toBe(2);d.storage.close();
});

it('environment status tracks current step without creating ordinary turns',async()=>{
 const d=setup(),web=new WebSearchService(new WebSearchStore(d.storage),undefined,d.clock);
 d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});
 let text='',host:SerialHost;
 const app=new HdsiApp({...d,web,generateEnvironment:async input=>{
 const step=d.environmentStore.steps().find(s=>s.status==='running')!;web.store.openStage('environment',step.id,input.stage,input.stage);
 expect(d.storage.unfinishedTurn()).toBeNull();text=await host.status();return input.stage==='world'?{stage:'world',changes:[]}:{stage:input.stage,planChanges:[],itemChanges:[]} as any;
 }});
 host=new SerialHost(app,{timers:false,onError:e=>{throw e;}});await host.start();expect(text).toContain('environment');expect(text).toContain('当前');await host.stop();d.storage.close();
});
