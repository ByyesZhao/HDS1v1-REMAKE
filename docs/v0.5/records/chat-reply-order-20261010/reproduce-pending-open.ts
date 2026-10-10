import {strict as assert} from 'node:assert';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {modern} from '../../../../tests/chat-fixture';
import {InputBuffer} from '../../../../src/host/input';
import {Scheduler} from '../../../../src/host/scheduler';
async function main(){const d=modern();try{
 const input=new InputBuffer(d.storage),scheduler=new Scheduler(d.storage);
 await input.acceptInput({id:'old-ready',content:'继续工作',receivedAt:d.clock.now()});d.clock.advance(15000);input.closeReady(d.clock.now());
 await input.acceptInput({id:'new-open',content:'计算挺好',receivedAt:d.clock.now()});
 const selected=await scheduler.collectReady(d.clock.now());
 assert.deepEqual(selected!.inputMessageIds,['old-ready']);assert.ok(d.storage.runtime().openBatch);assert.equal(d.storage.read('messages','new-open')!.seenTurnId,null);
 const result={sourceRevision:'6a88b9d',protocol:2,synthetic:true,olderReadyBatchSelectedDespiteNewOpenBatch:true,lastNewInputAgeMilliseconds:0,newerInputRemainsUnread:true};
 writeFileSync(join(__dirname,'evidence/pending-open-reproduction.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{d.storage.close();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
