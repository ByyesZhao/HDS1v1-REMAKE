import {afterEach,expect,it,vi} from 'vitest';
import {setup,saveInput,narrative,emptyMemory,NOW} from './helpers';
import {HdsiApp} from '../src/app';
import {ModelClient} from '../src/model/client';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
import {environmentTask} from '../src/model/contracts';
import {describeSticker} from '../src/output/sticker-description';
import {makeSharedFixture} from './shared-v3-fixture';
import {selectSharedMeta} from '../src/host/shared';
const close:Array<()=>void>=[];afterEach(()=>close.splice(0).forEach(f=>f()));
function fixture(){const d=setup();close.push(()=>d.storage.close());const store=new WebSearchStore(d.storage),provider={signature:'fixture',search:vi.fn(async()=>[{url:'https://example.test/page',title:'Snippet'}]),read:vi.fn(async()=>({title:'公开',body:'查阅了解到雨后空气清新。'}))},web=new WebSearchService(store,provider,d.clock,{enabled:true});return {...d,web,provider};}
it('runs narrative, life, expression and memory in independent sessions; memory receives actual reading body and grounded reaction',async()=>{
 const d=fixture(),requests:any[]=[];d.random.next=()=>0;const counts:Record<string,number>={};
 const models=new ModelClient({complete:async r=>{requests.push(r);const name=r.task.name;counts[name]=(counts[name]??0)+1;if(counts[name]===1)return {webSearch:{query:'雨后'}};
 if(name==='narrative')return narrative;if(name==='personal_life')return {innerThought:'刚查阅了雨后空气的资料，感觉清新',emotions:[],contact:{willing:true,intention:'分享阅读',draft:'刚看了资料'}};if(name==='expression')return {parts:[{kind:'text',content:'刚查阅了雨后的资料。'}]};
 const input=r.input as any;return {...emptyMemory,shortTermChanges:[{action:'create',clientRef:'reading',content:'查阅了解到雨后空气清新，感到舒畅',eventSummary:'查阅了雨后空气资料',feelingSummary:'舒畅',topics:['雨后'],sourceIds:[input.selfWebReadSources[0].id],importance:'normal'}]};}});
 await new HdsiApp({...d,models}).runTurn({inputMessageIds:[],taskIds:[],triggerKinds:['autonomous']});
 const sessions=d.storage.prepare('SELECT id FROM web_sessions').all().map(r=>d.web.store.snapshot(String(r.id)));expect(sessions.map(s=>s.ref.taskName).sort()).toEqual(['expression','memory','narrative','personal_life']);expect(sessions.map(s=>s.counters.successReads)).toEqual([1,1,1,1]);expect(d.provider.read).toHaveBeenCalledTimes(1);
 const input=requests.find(r=>r.task.name==='memory').input;expect(input.selfWebReadSources).toHaveLength(1);expect(input.selfWebReadMaterials[0].material.body).toContain('查阅了解到');expect(input.selfWebReadReactions.innerThought).toContain('刚查阅');expect(d.storage.all('memories').find((m:any)=>m.kind==='short')?.content).toContain('查阅');expect(d.storage.unfinishedTurn()).toBeNull();
});
it.each(['world','school'] as const)('validates %s sources from actual provided material at final parse, not initial empty URLs',async kind=>{
 const d=fixture(),result={changes:[{action:'create',event:{kind,startsAt:NOW,endsAt:null,description:'公开通知',basis:'web_reference',sourceUrls:['https://example.test/new']}}]},requests:any[]=[];let n=0;
 const models=new ModelClient({complete:async r=>{requests.push(r);return ++n===1?{webRead:{url:'https://example.test/new'}}:result;}});await new HdsiApp({...d,models}).runTurn({inputMessageIds:[],taskIds:[],triggerKinds:['environment'],environmentKind:kind});expect(d.storage.all('events')[0].sourceUrls).toEqual(['https://example.test/new']);expect(requests[0].webMaterials).toEqual([]);
 const ref=d.web.store.openStage('turn','other','environment',kind);expect(()=>environmentTask(kind,[],()=>d.web.providedUrls(ref.runId)).parse(result)).toThrow('URL was not supplied');
});
it('keeps unseen private messages out of ordinary narrative search input; chat gets its own identity',async()=>{
 const d=fixture();saveInput(d.storage,'private','未看私聊秘密');await new HdsiApp(d).runTurn({inputMessageIds:['private'],taskIds:[],triggerKinds:['input']});const call=d.models.calls[0];expect(JSON.stringify(call.input)).not.toContain('未看私聊秘密');expect(call.options?.runRef?.taskName).toBe('narrative');expect(d.models.calls.find(c=>c.name==='personal_chat')?.options?.web?.ref.stageKey).toBe('personal');
});
it('shared variants and sticker description actually obtain their own tool sessions without running mutually exclusive ordinary variants',async()=>{
 const d=fixture(),names:string[]=[];makeSharedFixture(d,{completedSteps:0});saveInput(d.storage,'s','共同复习');
 const models=new ModelClient({complete:async r=>{names.push(r.task.name);if(!r.webMaterials?.length)return {webRead:{url:'https://example.test/page'}};if(r.task.name==='narrative_shared')return {...narrative,publicNarration:'资料已备好，开始共同复习。',progress:'继续',outline:{goal:'复习',openThreads:[],endingCondition:'结束本次复习'},simulatedUserActions:[]};if(r.task.name==='personal_shared')return {emotions:[],reply:{decision:'none'},taskChanges:[]};if(r.task.name==='sticker_description')return {description:'实际图片中的挥手表情'};return emptyMemory;}});
 await new HdsiApp({...d,models}).runTurn({inputMessageIds:['s'],taskIds:[],triggerKinds:['input'],sharedMeta:selectSharedMeta(d.storage,NOW,['s'],[])});await describeSticker(models,d.web,'asset','image1','data:image/png;base64,OFFLINE');expect([...new Set(names)].sort()).toEqual(['memory','narrative_shared','personal_shared','sticker_description']);expect(d.web.store.openStage('asset','asset','sticker:image1','sticker_description').ownerType).toBe('asset');expect(d.web.selfReadSources('asset')).toEqual([]);
});

