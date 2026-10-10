import {strict as assert} from 'node:assert';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {modern} from '../../../../tests/chat-fixture';
import {silent} from '../../../../tests/helpers';
import {InputBuffer} from '../../../../src/host/input';
import {Scheduler} from '../../../../src/host/scheduler';
import {HdsiApp} from '../../../../src/app';
// Synthetic, in-memory diagnostic of current behavior; no model/API or QQ connection.
async function main(){
 const result:any={sourceRevision:'6a88b9d',protocol:2,synthetic:true};
 {
  const d=modern();try{
   const b=new InputBuffer(d.storage),s=new Scheduler(d.storage);
   await b.acceptInput({id:'a',content:'第一句',receivedAt:d.clock.now()});d.clock.advance(5000);
   await b.acceptInput({id:'b',content:'第二句',receivedAt:d.clock.now()});d.clock.advance(14999);
   assert.equal(await s.collectReady(d.clock.now()),null);d.clock.advance(1);
   const request=await s.collectReady(d.clock.now());assert.deepEqual(request!.inputMessageIds,['a','b']);
   result.quietWindow={milliseconds:15000,refreshesOnNewInput:true,beforeDeadlineSelected:false,atDeadlineIds:request!.inputMessageIds};
  }finally{d.storage.close();}
 }
 {
  const d=modern();try{
   const b=new InputBuffer(d.storage),s=new Scheduler(d.storage);
   await b.acceptInput({id:'older',content:'继续工作',receivedAt:d.clock.now()});d.clock.advance(16000);b.closeReady(d.clock.now());
   await b.acceptInput({id:'newer',content:'计算挺好',receivedAt:d.clock.now()});d.clock.advance(16000);b.closeReady(d.clock.now());
   const request=await s.collectReady(d.clock.now());assert.deepEqual(request!.inputMessageIds,['older']);
   assert.equal(d.storage.runtime().pendingBatchIds.length,2);
   result.pendingSelection={twoReadyBatches:true,selectedIds:request!.inputMessageIds,coalescesAllReady:false};
  }finally{d.storage.close();}
 }
 {
  const d=modern();try{
   const b=new InputBuffer(d.storage),s=new Scheduler(d.storage);const original=d.models.runModel.bind(d.models);
   d.models.outputs.personal_chat={emotions:[],taskChanges:[],reply:{decision:'now',intention:'结束工作前聊天',draft:'继续工作，顺了喊我'}};
   d.models.outputs.expression={parts:[{kind:'text',content:'好，那我继续看文献'},{kind:'text',content:'你算例顺了喊我'}]};
   await b.acceptInput({id:'old',content:'那咱们继续工作吧',receivedAt:d.clock.now()});d.clock.advance(15000);
   const request=await s.collectReady(d.clock.now());let injectedAt:string|null=null;
   d.models.runModel=async(task:any,input:any,options:any)=>{
    const output=await original(task,input,options);
    if(task.name==='personal_chat'&&!injectedAt){d.clock.advance(1000);injectedAt=d.clock.now();await b.acceptInput({id:'latest',content:'计算挺好',receivedAt:injectedAt});d.clock.advance(5000);}
    return output;
   };
   await new HdsiApp(d).runTurn(request!);
   const firstPersonal=d.models.calls.find(c=>c.name==='personal_chat')!;
   assert.deepEqual(firstPersonal.input.roles.visibleIds,['old']);assert.equal(firstPersonal.input.resources.messages.some((m:any)=>m.id==='latest'),false);
   assert.equal(d.sender.sent.length,2);assert.equal(d.storage.read('messages','latest')!.seenTurnId,null);
   const oldOutgoing=d.storage.messages().filter(m=>m.direction==='outgoing');
   assert.ok(oldOutgoing.every(m=>Date.parse(m.receivedAt)>Date.parse(injectedAt!)));
   d.clock.advance(16000);d.models.outputs.personal_chat=silent;
   const next=await s.collectReady(d.clock.now());assert.deepEqual(next!.inputMessageIds,['latest']);await new HdsiApp(d).runTurn(next!);
   const latestPersonal=d.models.calls.filter(c=>c.name==='personal_chat').at(-1)!;
   assert.deepEqual(latestPersonal.input.roles.visibleIds,['latest']);assert.ok(oldOutgoing.every(m=>latestPersonal.input.roles.recentIds.includes(m.id)));
   assert.ok(d.storage.read('messages','latest')!.seenTurnId);assert.equal(d.sender.sent.length,2);
   result.inFlight={latestArrivesBeforeFirstSend:true,oldTurnVisibleIds:firstPersonal.input.roles.visibleIds,latestExcludedFromOldPayload:true,oldReplyStillSent:true,nextTurnVisibleIds:latestPersonal.input.roles.visibleIds,nextPayloadIncludesPreviousOutgoing:true,nextTurnCanReadAndStaySilent:true};
  }finally{d.storage.close();}
 }
 writeFileSync(join(__dirname,'evidence/offline-reproduction.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
