import {it,expect,vi} from 'vitest';
import {ResourcePool,buildCompletionEnvelope} from '../src/model/resource-pool';
import {stageInput} from '../src/model/context-views';
import {setup,NOW} from './helpers';
import {MemoryStore} from '../src/memory/store';
it('pool identity keeps first insertion, distinct IDs with same body, versions and independent pools',()=>{
 const p=new ResourcePool(),m=(id:string,content='正文')=>({id,content,direction:'incoming' as const,receivedAt:NOW}),a=m('a'),b=m('b');
 p.message(a);p.message(b);p.message(m('a','改变'));expect(p.data.messages).toEqual([a,b]);const d=setup();try{const store=new MemoryStore(d.storage),owner=store.makeOwner({ownerType:'long',ownerId:'o'},{content:'正文'},NOW),views=stageInput('memory',{retrieved:[owner,{...owner,revision:2,stateVersion:2}]});views.resources.owners.forEach(r=>p.owner(r));p.owner({...views.resources.owners[0],content:'改变'});expect(p.data.owners).toEqual(views.resources.owners);
 const before=structuredClone(p.data),merged=new ResourcePool();merged.merge(p.data);merged.merge(p.data);expect(merged.data).toEqual(before);expect(p.data).toEqual(before);expect(new ResourcePool().data.messages).toEqual([]);
 }finally{d.storage.close();}
});
it.each([1000,5000,10000])('membership work is linear and full activity/role/envelope bodies survive N=%s',N=>{
 const pool=new ResourcePool(),keys=['messageIds','taskIds','ownerRefs','materialIds'],spies=keys.map(key=>{const set=(pool as any)[key] as Set<string>;return {has:vi.spyOn(set,'has'),add:vi.spyOn(set,'add')};});
 const messages=Array.from({length:N},(_,i)=>({id:'m'+i,content:i===N-1?'末尾sentinel':'正文',direction:'incoming' as const,receivedAt:NOW}));
 const tasks=messages.map((m,i)=>({id:'t'+i,kind:'appointment' as const,description:m.content,at:NOW})),owners=messages.map((m,i)=>({ref:'o'+i,id:'o'+i,kind:'long',revision:1,stateVersion:1,eventSummary:m.content} as any)),materials=messages.map((m,i)=>({id:'w'+i,body:m.content} as any));
 try{for(let pass=0;pass<2;pass++){messages.forEach(m=>pool.message(m));tasks.forEach(t=>pool.task(t));owners.forEach(o=>pool.owner(o));materials.forEach(m=>pool.material(m));}pool.merge(pool.data);
 for(const spy of spies){expect(spy.has).toHaveBeenCalledTimes(3*N);expect(spy.add).toHaveBeenCalledTimes(N);}
 expect(pool.data.messages).toEqual(messages);const view=stageInput('personal_shared',{dialogueWindowVersion:2,currentActivityMessages:messages,visibleMessages:messages});expect(view.resources.messages).toHaveLength(N);expect(view.roles.visibleIds).toHaveLength(N);expect(view.roles.currentActivityMessageIds).toHaveLength(N);
 const envelope=buildCompletionEnvelope({task:{name:'personal_shared',prompt:'test',schema:{},parse:x=>x},input:view});expect(envelope.resources.messages).toHaveLength(N);expect(envelope.resources.messages[N-1].content).toBe('末尾sentinel');
 }finally{spies.forEach(s=>{s.has.mockRestore();s.add.mockRestore();});}
});
