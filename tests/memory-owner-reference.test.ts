import {afterEach,expect,it} from 'vitest';
import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {consolidationTask,auditTask} from '../src/model/contracts';
import {stageInput,projectOwner} from '../src/model/context-views';
import {buildCompletionEnvelope} from '../src/model/resource-pool';
import {NOW} from './helpers';
const stores:Storage[]=[];
afterEach(()=>stores.splice(0).forEach(s=>s.close()));
function fixture(){
 const storage=new Storage(':memory:');stores.push(storage);const store=new MemoryStore(storage);store.migrate(NOW);
 const short=store.makeOwner({ownerType:'short',ownerId:'s'},{content:'详细经历',sourceIds:['message'],linkedLongId:'l'},NOW);
 const long=store.makeOwner({ownerType:'long',ownerId:'l'},{content:'已有摘要',eventSummary:'已有摘要',sourceIds:['message']},NOW);
 const snapshot=[short,long],task=consolidationTask(snapshot,['s','l']);
 const envelope=buildCompletionEnvelope({task,input:stageInput('memory_consolidation',{snapshot,selectedIds:['s','l']})});
 const refs=Object.fromEntries(envelope.resources.owners.map(o=>[o.id,o.ref]));
 const unit={unitKey:'keep',action:'retain',ids:['s','l'],readOwners:[refs.s,refs.l],sourceIds:[]};
 return {snapshot,task,refs,unit,store};
}
it('accepts sent snapshot refs and mixed IDs while returning business IDs without mutating the response',()=>{
 const d=fixture(),raw={units:[{...d.unit,readOwners:[d.refs.s,'l']}]},before=structuredClone(raw);
 const [unit]=d.task.parse(raw);expect(unit).toMatchObject({readOwners:['s','l']});
 expect(unit.readSet.map(r=>r.ownerId)).toEqual(['s','l']);expect(raw).toEqual(before);
});
it.each(['owner:unknown','old-revision'])('rejects references outside the exact snapshot (%s)',bad=>{
 const d=fixture(),ref=bad==='old-revision'?projectOwner({...d.snapshot[0],revision:d.snapshot[0].revision+1},'maintenance').ref:bad;
 expect(()=>d.task.parse({units:[{...d.unit,readOwners:[ref,d.refs.l]}]})).toThrow('unknown snapshot owner');
});
it('still rejects writes outside normalized readOwners',()=>{
 const d=fixture();expect(()=>d.task.parse({units:[{...d.unit,readOwners:[d.refs.s]}]})).toThrow('writes outside readOwners');
});
it('detects overlapping units after one uses refs and the other uses business IDs',()=>{
 const d=fixture();expect(()=>d.task.parse({units:[d.unit,{...d.unit,unitKey:'again',readOwners:['s','l']}]})).toThrow('overlapping unit');
});
it('does not treat owner refs as write IDs or historical source IDs',()=>{
 const d=fixture();expect(()=>d.task.parse({units:[{...d.unit,ids:[d.refs.s,d.refs.l]}]})).toThrow('writes outside readOwners');
 expect(()=>d.task.parse({units:[{...d.unit,sourceIds:[d.refs.s]}]})).toThrow('unknown snapshot source');
});
it('supports refs for fixed-information audit without changing the target identity',()=>{
 const d=fixture(),detail=d.store.makeOwner({ownerType:'detail',ownerId:'detail'},{content:'固定信息',sourceIds:['message']},NOW);
 const ref=projectOwner(detail,'maintenance').ref;
 const [unit]=auditTask([detail],['detail']).parse({units:[{unitKey:'review',action:'review_detail',ids:['detail'],targetId:'detail',readOwners:[ref],sourceIds:[],decision:'retain'}]});
 expect(unit).toMatchObject({readOwners:['detail']});expect(unit.targetId).toBe('detail');expect(unit.readSet[0].ownerId).toBe('detail');
});
