import {it,expect} from 'vitest';import {fixture,long,at} from './memory-capacity-fixture';
import {MemoryCapacity} from '../src/memory/capacity';import {defaultMemoryCapacity} from '../src/memory/types';
it('full but not overflowing pool avoids awakening-history sorting reads',()=>{
 const d=fixture();for(let i=0;i<1000;i++)long(d.store,`l-${i}`);
 let queries=0;const read=d.store.listAwakenings.bind(d.store);d.store.listAwakenings=id=>{queries++;return read(id);};
 const result=new MemoryCapacity(d.store,defaultMemoryCapacity).normalize(at);expect(result.changedOwners).toHaveLength(0);expect(result.counts.longOccupied).toBe(1000);expect(queries).toBe(0);
});
