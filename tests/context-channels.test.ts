import {it,expect,vi} from 'vitest';
import {modern} from './chat-fixture';
import {setup,NOW,saveInput} from './helpers';
import {ContextBuilder} from '../src/memory/context';
import {MemoryStore} from '../src/memory/store';
import {MemoryRetrieval,makeRetrievalRequest} from '../src/memory/retrieval';
import {ChatEpisodes} from '../src/dialogue/chat-episodes';
import {DialogueEpisodes} from '../src/dialogue/episodes';
import {countVisibleCharacters} from '../src/output/qq';
it.each([1,2] as const)('retrieval recent defaults on; owner-only skips window version %s',async version=>{
 const d=version===2?modern():setup();try{saveInput(d.storage,'m','手机');d.storage.save('messages','m',{...d.storage.read('messages','m')!,seenTurnId:'seen'});
 const store=new MemoryStore(d.storage),r=new MemoryRetrieval(store),q=makeRetrievalRequest('手机',NOW,'personal');q.dialogueWindowVersion=version;
 const ordinary=await r.build(q);expect(await r.build(q,{includeRecent:true})).toEqual(ordinary);
 const modernSpy=vi.spyOn(ChatEpisodes.prototype,'recent'),legacySpy=vi.spyOn(DialogueEpisodes.prototype,'recent');
 try{expect(await r.build(q,{includeRecent:false})).toEqual({...ordinary,recent:[]});expect(modernSpy).not.toHaveBeenCalled();expect(legacySpy).not.toHaveBeenCalled();}finally{modernSpy.mockRestore();legacySpy.mockRestore();}
 }finally{d.storage.close();}
});
it('memory lookup preserves permissions and budgets only the transmitted owner projection once',async()=>{
 const d=modern();try{saveInput(d.storage,'m','手机'+'原文'.repeat(1000));d.storage.save('messages','m',{...d.storage.read('messages','m')!,seenTurnId:'seen'});
 const store=new MemoryStore(d.storage);store.saveOwner(store.makeOwner({ownerType:'detail',ownerId:'phone'},{content:'手机品牌',key:'手机',value:'A',sourceIds:[]},NOW));
 const r=new MemoryRetrieval(store),b=new ContextBuilder(d.storage,r),base=makeRetrievalRequest('手机',NOW,'memory');base.dialogueWindowVersion=2;
 const raw=await r.build(base),view={details:raw.details,retrieved:[...raw.shortTerm,...raw.longTerm,...raw.learned]};
 const build=vi.spyOn(r,'build'),budget=vi.spyOn(r,'budget'),recent=vi.spyOn(ChatEpisodes.prototype,'recent');
 try{
 for(const request of [{query:'手机',scope:'archive' as const,includeDetailHistory:false},{query:'手机',scope:'current' as const,includeDetailHistory:true}])await expect(b.lookupForMemory(request,base)).rejects.toThrow('retrieval permission denied');
 expect(build).not.toHaveBeenCalled();expect(recent).not.toHaveBeenCalled();
 const B=countVisibleCharacters(JSON.stringify(view)),finite={...base,budget:B},before=structuredClone(finite);
 expect(await b.lookupForMemory('手机',finite)).toEqual(view);expect(budget).toHaveBeenCalledTimes(1);expect(budget).toHaveBeenCalledWith(view,B,base.permissions.visibleSourceIds);expect(build).toHaveBeenLastCalledWith(finite,{includeRecent:false});expect(finite).toEqual(before);expect(recent).not.toHaveBeenCalled();
 const oracle=r.budget(structuredClone(view),B-1,base.permissions.visibleSourceIds);budget.mockClear();expect(await b.lookupForMemory('手机',{...base,budget:B-1})).toEqual(oracle);expect(budget).toHaveBeenCalledTimes(1);expect(await b.buildForMemory(base)).toEqual(view);
 }finally{build.mockRestore();budget.mockRestore();recent.mockRestore();}
 }finally{d.storage.close();}
});
it('memory owner-only keeps source consistency gate',async()=>{
 const d=modern();try{saveInput(d.storage,'m','手机');d.storage.save('messages','m',{...d.storage.read('messages','m')!,seenTurnId:'seen'});const store=new MemoryStore(d.storage);
 store.saveOwner(store.makeOwner({ownerType:'detail',ownerId:'phone'},{content:'手机',key:'手机',value:'A',sourceIds:['m']},NOW));d.storage.save('messages','m',{...d.storage.read('messages','m')!,chatEpisodeId:'missing'});
 await expect(new ContextBuilder(d.storage,new MemoryRetrieval(store)).buildForMemory(makeRetrievalRequest('手机',NOW,'memory'))).rejects.toThrow('chat 对话段索引不一致');
 }finally{d.storage.close();}
});
