// Read-only product review: all application data below is synthetic and in memory.
// Assertions describe the 3fb4e1c baseline, not acceptance of the proposed feature.
import {strict as assert} from 'node:assert';
import {modern} from '../../../../tests/chat-fixture';
import {InputBuffer} from '../../../../src/host/input';
import {Scheduler} from '../../../../src/host/scheduler';
import {HdsiApp} from '../../../../src/app';
import {ModelClient} from '../../../../src/model/client';
import {WebSearchStore} from '../../../../src/web/store';
import {WebSearchService} from '../../../../src/web/service';
import {phaseOptions} from '../../../../src/web/phases';
import {IncomingMediaStore} from '../../../../src/input-media/store';
import {IncomingMediaService} from '../../../../src/input-media/service';
import {IncomingAssets,AttachmentResolver} from '../../../../src/input-media/assets';

async function main() {
  const result:Record<string,unknown>={sourceRevision:'3fb4e1c71c5b82ba4408f75e581a0cdc4021ca35',synthetic:true,protocol:2};
  {
    const d=modern();
    try {
      const b=new InputBuffer(d.storage),s=new Scheduler(d.storage);
      await b.acceptInput({id:'old-ready',content:'first',receivedAt:d.clock.now()});
      d.clock.advance(15000);b.closeReady(d.clock.now());
      await b.acceptInput({id:'new-open',content:'latest',receivedAt:d.clock.now()});
      const early=await s.collectReady(d.clock.now());
      assert.deepEqual(early!.inputMessageIds,['old-ready']);
      d.clock.advance(15000);
      const bothReady=await s.collectReady(d.clock.now());
      assert.deepEqual(bothReady!.inputMessageIds,['old-ready']);
      assert.equal(d.storage.runtime().pendingBatchIds.length,2);
      result.selection={startsOldAtNewInputAgeMs:0,selectedWhenBothReady:bothReady!.inputMessageIds,pendingBatches:2};
    } finally {d.storage.close();}
  }
  {
    const d=modern();
    try {
      const b=new InputBuffer(d.storage),s=new Scheduler(d.storage);
      await b.acceptInput({id:'before',content:'continue work',receivedAt:d.clock.now()});
      d.clock.advance(15000);
      const request=(await s.collectReady(d.clock.now()))!;
      d.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'reply',draft:'old answer'},taskChanges:[]};
      d.models.outputs.expression={parts:[{kind:'text',content:'old answer'}]};
      const run=d.models.runModel.bind(d.models);
      let injected=false;
      d.models.runModel=async(task,input,options)=>{
        const output=await run(task,input,options);
        if(task.name==='personal_chat'&&!injected){
          injected=true;d.clock.advance(1);
          await b.acceptInput({id:'during',content:'already answered',receivedAt:d.clock.now()});
        }
        return output;
      };
      await new HdsiApp(d).runTurn(request);
      assert.equal(d.sender.sent[0].payload,'old answer');
      assert.equal(d.storage.read('messages','during')!.seenTurnId,null);
      result.inFlight={newInputBeforeFirstSend:true,oldAnswerStillSent:true,newInputRemainsUnread:true};
    } finally {d.storage.close();}
  }
  {
    const d=modern();
    try {
      // Capture a real unfinished generation, then inspect the existing scheduler contract.
      const b=new InputBuffer(d.storage),s=new Scheduler(d.storage);
      await b.acceptInput({id:'before',content:'first',receivedAt:d.clock.now()});
      d.clock.advance(15000);
      d.models.outputs.narrative=()=>{throw Error('synthetic generation interruption');};
      await assert.rejects(new HdsiApp(d).runTurn((await s.collectReady(d.clock.now()))!),/synthetic/);
      d.storage.set('runtime',{...d.storage.runtime(),paused:false});
      d.storage.save('tasks','due',{id:'due',kind:'appointment',at:d.clock.now(),description:'synthetic appointment',status:'pending'});
      assert.equal(await s.collectReady(d.clock.now()),null);
      assert.equal(await s.nextDeadline(d.clock.now()),null);
      result.unfinishedContract={dueAppointmentBlocked:true,schedulerDeadline:null};
    } finally {d.storage.close();}
  }
  {
    const d=modern();
    try {
      const web=new WebSearchService(new WebSearchStore(d.storage),{
        signature:'review-fixture',search:async()=>[],read:async()=>({title:'public',body:'synthetic public material'})
      },d.clock,{enabled:true});
      const seen:Array<any>=[];let calls=0;
      const client=new ModelClient({complete:async request=>{
        seen.push(structuredClone({input:request.input,lookupResult:request.lookupResult,webMaterials:request.webMaterials,webResults:request.webResults}));calls++;
        if(calls===1)return {lookupDetails:'old question'};
        if(calls===2)return {webRead:{url:'https://example.test/review'}};
        return {ok:true};
      }});
      const task={name:'personal_chat',schema:{},prompt:'synthetic',parse:(x:unknown)=>x};
      const first=phaseOptions(web,'turn','synthetic-turn','personal','personal_chat',{lookup:async()=>({from:'old-private-lookup'})});
      await client.runModel(task,{request:'old'},first);
      const same=phaseOptions(web,'turn','synthetic-turn','personal','personal_chat',{lookup:async()=>({from:'new-private-lookup'})});
      await client.runModel(task,{request:'new'},same);
      const repeated=seen.at(-1);
      assert.equal(first.runRef!.runId,same.runRef!.runId);
      assert.deepEqual(repeated.lookupResult,{from:'old-private-lookup'});
      assert.equal(repeated.webMaterials.length,1);
      assert.equal(repeated.webResults.length,1);
      const next=phaseOptions(web,'turn','synthetic-turn','reply:2:personal','personal_chat',{lookup:async()=>({from:'new-private-lookup'})});
      await client.runModel(task,{request:'new'},next);
      assert.equal(seen.at(-1).lookupResult,undefined);
      assert.equal(seen.at(-1).webMaterials.length,0);
      result.stageIdentity={sameStageReusesPrivateLookup:true,sameStageInjectsOldPublicMaterials:true,sameStageReusesToolResults:true,newStageStartsWithoutOldPayload:true};
    } finally {d.storage.close();}
  }
  {
    const d=modern();
    try {
      const store=new IncomingMediaStore(d.storage);
      const assets=new IncomingAssets(store,'.tmp/unused-review-assets',new AttachmentResolver(async()=>{throw Error('unexpected network');}));
      const service=new IncomingMediaService(store,assets,d.models,{enabled:false});
      store.register([{id:'a',messageId:'m',order:0,kind:'image'}]);
      d.storage.save('turns','image-turn',{id:'image-turn',visualContext:{version:1,entries:[]}} as any);
      const first=await service.prepareForTurn('image-turn',['m']);
      assert.equal(first[0].status,'unrecognized');
      store.saveObservation({id:'later-observation',contentHash:'synthetic',recognizerVersion:'synthetic-version',origin:'vision',observation:{description:'synthetic later cache',visibleText:[],possibleTone:null,uncertain:false},confirmedAt:d.clock.now()});
      d.storage.save('message_attachments','a',{...d.storage.read('message_attachments','a')!,confirmedObservationRef:'later-observation',confirmedRecognizerVersion:'synthetic-version'});
      assert.equal((await service.prepareForTurn('image-turn',['m']))[0].status,'unrecognized');
      const t=d.storage.read('turns','image-turn')!;
      d.storage.save('turns',t.id,{...t,visualContext:{version:1,entries:[]}});
      assert.equal((await service.prepareForTurn('image-turn',['m']))[0].status,'ready');
      result.visualFreeze={terminalUnknownPreservedWithSnapshot:true,clearingSnapshotChangesUnknownToReady:true,modelCalls:0};
      await service.stop();
    } finally {d.storage.close();}
  }
  console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
