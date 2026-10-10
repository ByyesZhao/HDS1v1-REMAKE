// Synthetic evidence only; no settings, formal database, network or QQ.
import {writeFileSync} from 'node:fs';
import {modern} from '../../../../tests/chat-fixture';
import {HdsiApp} from '../../../../src/app';
import {InputBuffer} from '../../../../src/host/input';
import {Scheduler} from '../../../../src/host/scheduler';
async function main(){
 const d=modern(),b=new InputBuffer(d.storage),s=new Scheduler(d.storage);let arrived=false;
 try{
 await b.acceptInput({id:'synthetic-old',content:'准备继续测试',receivedAt:d.clock.now()});d.clock.advance(15000);const request=(await s.collectReady(d.clock.now()))!;
 const run=d.models.runModel.bind(d.models);d.models.runModel=async(t,i,o)=>{const value=await run(t,i,o);if(t.name==='narrative'&&!arrived){arrived=true;await b.acceptInput({id:'synthetic-latest',content:'测试新状态已确定',receivedAt:d.clock.now()});}return value;};
 d.models.outputs.personal_chat=(input:any)=>({emotions:[],reply:{decision:'now',intention:'按本次可见的最新输入回应',draft:input.visibleMessages.at(-1).content},taskChanges:[]});
 d.models.outputs.expression=(input:any)=>({parts:[{kind:'text',content:input.intent.draft}]});
 const app=new HdsiApp(d);await app.runTurn(request);const id=d.storage.unfinishedTurn()!.id;
 d.clock.advance(14999);const early=await s.collectWaitingContinuation(id,d.clock.now());const callsBefore=d.models.calls.length;
 d.clock.advance(1);const next=await s.collectWaitingContinuation(id,d.clock.now());if(next.kind!=='run')throw Error('latest window not selected');await app.continueWaitingTurn(id,next.request,next.scope);
 const turn=d.storage.read('turns',id)!;
 const evidence={scope:'synthetic scripted models and sender; not real model quality',selectedRequest:request,at14999:early,callsBeforeQuietEnd:callsBefore,final:{id,done:turn.done,inputMessageIds:turn.inputMessageIds,batchIds:turn.batchIds,freshness:turn.replyFreshness,trace:turn.replyTrace},messages:d.storage.messages().map(m=>({id:m.id,receivedAt:m.receivedAt,batchId:m.batchId,seenTurnId:m.seenTurnId,direction:m.direction})),modelCalls:d.models.calls.map(c=>({stage:c.name,visibleIds:c.input.roles?.visibleIds??[],messageIds:c.input.resources?.messages.map((m:any)=>m.id)??[]})),syntheticSent:d.sender.sent.map(i=>i.payload),errors:d.sender.errors};
 if(!turn.done||turn.replyFreshness?.generation!==2||d.sender.sent[0]?.payload!=='测试新状态已确定'||d.sender.errors.length)throw Error('timeline evidence assertion failed');
 writeFileSync(new URL('./evidence/synthetic-timeline.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');console.log('latest input selected after full 15000ms; generation=2; one current reply; no error');
 }finally{d.storage.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
