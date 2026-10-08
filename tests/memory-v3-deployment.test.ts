import { afterEach,expect,it,vi } from 'vitest';
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings,connectionFor,modelRoles,appConfig } from '../src/settings';
import { ChatCompletionsTransport,ModelClient } from '../src/model/client';
import { prepareCharacterBackground } from '../src/deployment/character-background';
import { HdsiApp } from '../src/app';
import { setup,saveInput,NOW } from './helpers';
import { MemoryStore } from '../src/memory/store';
import { assembleMemory } from '../src/deployment/memory-runtime';
const dirs:string[]=[];afterEach(()=>dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true})));
function settings(change:(sample:any)=>void=()=>{}){const dir=mkdtempSync(join(tmpdir(),'hdsi-v3-settings-'));dirs.push(dir);const sample=JSON.parse(readFileSync('examples/story.sample.json','utf8'));change(sample);writeFileSync(join(dir,'config.json'),JSON.stringify(sample));return loadSettings(join(dir,'config.json'),{});}
it('configures thirteen independent task models, consolidation Flash/high, nullable budgets and independent embedding identities',()=>{
  const s=settings(sample=>{sample.models.personal_life.model='deepseek-v4-pro';sample.embedding={baseUrl:'https://example.test/v1',model:'qwen-sticker',dimensions:2};sample.memoryEmbedding={baseUrl:'https://example.test/v1',model:'qwen-memory',dimensions:2};});
  expect([...modelRoles,'sticker_description']).toHaveLength(13);expect(connectionFor(s,'memory_consolidation',{DEEPSEEK_API_KEY:'fixture'})).toMatchObject({model:'deepseek-flash',reasoningEffort:'high'});expect(connectionFor(s,'personal_life',{DEEPSEEK_API_KEY:'fixture'}).model).toBe('deepseek-v4-pro');
  expect(s.memoryEmbedding.model).toBe('qwen-memory');expect(s.embedding!.model).not.toBe('qwen-memory');expect(appConfig(s).historyBudget).toBeNull();expect(s.memory.contextLimits).toMatchObject({longItemsLimit:null,alwaysIncludeCharactersLimit:null,candidateItemsPerRoute:null});expect((s as any).webMaterialCharactersLimit).toBeUndefined();
});
it('defaults omitted limits to null and preserves task routing and uncapped HTTP requests',async()=>{
  const s=settings(sample=>{delete sample.historyBudget;delete sample.memory;});let body:any;const transport=new ChatCompletionsTransport(name=>connectionFor(s,name,{DEEPSEEK_API_KEY:'fixture'}),(async(_url,init)=>{body=JSON.parse(String(init?.body));return new Response(JSON.stringify({choices:[{message:{content:'{}'}}]}));}) as typeof fetch);await transport.complete({task:{name:'memory_consolidation',prompt:'',schema:{},parse:v=>v},input:{}});expect(body).toMatchObject({model:'deepseek-flash',reasoning_effort:'high'});expect(body.max_tokens).toBeUndefined();expect(body.max_completion_tokens).toBeUndefined();expect(s.historyBudget).toBeNull();
});
it('front capacity failure preserves unfinished work, pauses without pruning and makes one request',async()=>{
  const d=setup();try{new MemoryStore(d.storage).migrate(NOW);saveInput(d.storage,'input','原始输入');const original=d.models.runModel.bind(d.models);const call=vi.fn(async(task:any,input:any,options:any)=>{if(task.name==='narrative')throw new Error('context capacity exceeded');return original(task,input,options);});d.models.runModel=call as typeof d.models.runModel;
    await expect(new HdsiApp(d).runTurn({inputMessageIds:['input'],taskIds:[],triggerKinds:['input']})).rejects.toThrow('capacity');expect(call).toHaveBeenCalledTimes(1);expect(d.storage.runtime()).toMatchObject({paused:true,lastError:'context capacity exceeded'});expect(d.storage.unfinishedTurn()).not.toBeNull();expect(d.storage.read('messages','input')!.content).toBe('原始输入');expect(d.storage.all('memories')).toEqual([]);
  }finally{d.storage.close();}
});
it('extracts only explicitly selected background facts with source mapping and never overwrites the author source',()=>{
  const input='她是大二学生，热爱音乐。\n\n手机：A牌。\n\n室友林安读数学专业。';
  const preview=prepareCharacterBackground(input,[{paragraph:1,key:'character.phone',value:'A牌',aliases:['手机']},{paragraph:2,key:'roommate.lin',value:'林安，数学专业',aliases:['室友','林安']}]);
  expect(preview.core).toBe('她是大二学生，热爱音乐。');expect(preview.details).toMatchObject([{key:'character.phone',value:'A牌'},{key:'roommate.lin',value:'林安，数学专业'}]);expect(preview.sourceMap).toMatchObject([{paragraph:1,key:'character.phone'},{paragraph:2,key:'roommate.lin'}]);expect(input).toContain('手机：A牌。');
  const unreviewed=prepareCharacterBackground(input);expect(unreviewed.core).toBe(input);expect(unreviewed.status).toBe('review_required');expect(unreviewed.details).toEqual([]);
});
it('assembles one memory store/lifecycle/index/retrieval/coordinator and registers vectors without a network call',async()=>{
  const d=setup();try{const store=new MemoryStore(d.storage);store.migrate(NOW);const row=store.makeOwner({ownerType:'detail',ownerId:'phone'},{content:'A',key:'phone',value:'A',aliases:['手机']},NOW);store.saveOwner(row);store.migrateCapacity(NOW);const s=settings();const fetcher=vi.spyOn(globalThis,'fetch');const memory=assembleMemory(d.storage,s,d.models,d.clock,()=>{}, {QWEN_API_KEY:'fixture'},store);expect(memory.store).toBe(store);expect(memory.lifecycle.store).toBe(store);expect(memory.retrieval.store).toBe(store);expect(store.jobs<any>('memory_index_jobs').some(j=>j.configSignature===memory.index.configSignature)).toBe(true);expect(fetcher).not.toHaveBeenCalled();fetcher.mockRestore();await memory.maintenance.stop();}finally{d.storage.close();}
});
