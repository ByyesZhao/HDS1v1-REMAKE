import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fixture,at} from './memory-capacity-fixture';
import {loadSettings} from '../src/settings';
import {assembleMemory} from '../src/deployment/memory-runtime';
import {HdsiApp} from '../src/app';
import {SerialHost} from '../src/host/runtime';
const dirs:string[]=[];afterEach(()=>dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true})));
function settings(){const dir=mkdtempSync(join(tmpdir(),'hdsi-cap-settings-'));dirs.push(dir);writeFileSync(join(dir,'config.json'),readFileSync('examples/story.sample.json'));return loadSettings(join(dir,'config.json'),{});}
it('startup_old_marker_named_error',()=>{const d=fixture();expect(()=>assembleMemory(d.storage,settings(),d.models,d.clock,()=>{},{QWEN_API_KEY:'test'},d.store)).toThrow(/memory:capacity/);});
it('fresh_seed_and_status_counts',async()=>{
 const d=fixture();d.store.migrateCapacity(at);const memory=assembleMemory(d.storage,settings(),d.models,d.clock,()=>{},{QWEN_API_KEY:'test'},d.store);
 expect(memory).toMatchObject({capacity:expect.anything(),idle:expect.anything(),cleanup:expect.anything()});expect(memory.lifecycle.capacity).toBe(memory.capacity);
 const h=new SerialHost(new HdsiApp({...d,memoryStore:d.store,memoryCapacity:memory.capacity,memoryIdle:memory.idle,memoryCleanup:memory.cleanup,maintenance:memory.maintenance}),{timers:false});
 const read=vi.spyOn(d.store,'allOwners');const status=await h.status();expect(status).toContain('长期');expect(status).toContain('空闲');expect(read).not.toHaveBeenCalled();await h.stop();
});
