import {it,expect} from 'vitest';
import {modern} from './chat-fixture';
import {HdsiApp,generateTurn} from '../src/app';
import {InputBuffer} from '../src/host/input';
import {Scheduler} from '../src/host/scheduler';
import {freezeTurn,sendFrozen,finishPostprocessing} from '../src/recovery';
import {narrative} from './helpers';
async function ready(){const d=modern();await new InputBuffer(d.storage).acceptInput({id:'a',content:'old',receivedAt:d.clock.now()});d.clock.advance(15000);const request=(await new Scheduler(d.storage).collectReady(d.clock.now()))!;return {d,request};}
async function append(d:ReturnType<typeof modern>){await new InputBuffer(d.storage).acceptInput({id:'b',content:'latest',receivedAt:d.clock.now()});}
for(const stage of ['narrative','personal_chat','expression'])it('supersedes after '+stage,async()=>{
 const {d,request}=await ready();d.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'answer',draft:'old'},taskChanges:[]};d.models.outputs.expression={parts:[{kind:'text',content:'old'}]};
 d.models.outputs.narrative={...narrative,experiences:[{happenedAt:d.clock.now(),description:'uncommitted',relatedEventIds:[]}]};
 const run=d.models.runModel.bind(d.models);d.models.runModel=async(t,i,o)=>{const r=await run(t,i,o);if(t.name===stage)await append(d);return r;};
 await new HdsiApp(d).runTurn(request);expect(d.storage.unfinishedTurn()?.replyFreshness?.state).toBe('waiting');expect(d.sender.sent).toEqual([]);expect(d.sender.errors).toEqual([]);expect(d.storage.runtime().paused).toBe(false);expect(d.storage.all('experiences')).toEqual([]);expect(d.storage.read('messages','a')!.seenTurnId).toBeNull();
 expect(d.models.calls.map(c=>c.name)).toEqual(['narrative','personal_chat','expression'].slice(0,['narrative','personal_chat','expression'].indexOf(stage)+1));d.storage.close();
});
it('input_between_selection_and_run_is_not_stamped_current',async()=>{const {d,request}=await ready();await append(d);await new HdsiApp(d).runTurn(request);expect(d.models.calls).toEqual([]);expect(d.storage.unfinishedTurn()?.replyFreshness).toMatchObject({state:'waiting',inputRevision:1,generation:1});d.storage.close();});
it('new_input_after_sending_does_not_replace_tail',async()=>{const {d,request}=await ready();d.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'answer',draft:'old'},taskChanges:[]};d.models.outputs.expression={parts:[{kind:'text',content:'first'},{kind:'text',content:'tail'}]};const send=d.sender.sendItem.bind(d.sender);d.sender.sendItem=async i=>{if(i.seq===0)await append(d);return send(i);};await new HdsiApp(d).runTurn(request);expect(d.sender.sent.map(i=>i.payload)).toEqual(['first','tail']);expect(d.storage.all('turns')[0].replyFreshness?.state).toBe('sealed');expect(d.storage.read('messages','b')!.seenTurnId).toBeNull();d.storage.close();});
it('silent_freeze_rechecks_but_postprocessing_is_sealed',async()=>{const {d,request}=await ready();const app=new HdsiApp(d);const run=d.models.runModel.bind(d.models);d.models.runModel=async(t,i,o)=>{if(t.name==='memory')await append(d);return run(t,i,o);};await app.runTurn(request);expect(d.storage.all('turns')[0].replyFreshness?.state).toBe('sealed');expect(d.storage.all('turns')[0].done).toBe(true);expect(d.storage.read('messages','b')!.seenTurnId).toBeNull();d.storage.close();});

it.each(['images','sticker'])('supersedes after %s preparation',async kind=>{
 const {d,request}=await ready();d.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'respond',draft:'old'},taskChanges:[]};d.models.outputs.expression={parts:[{kind:'text',content:'old'}]};d.random.next=()=>0;
 const app=new HdsiApp({...d,config:{...d.config,stickersEnabled:kind==='sticker'},stickers:{findSticker:async()=>{await append(d);return 's';}},incomingMedia:kind==='images'?{prepareForTurn:async()=>{await append(d);},readFrozenForTurn:()=>[],readConfirmedForMessages:()=>[]} as any:undefined});await app.runTurn(request);expect(d.storage.unfinishedTurn()!.replyFreshness?.state).toBe('waiting');expect(d.sender.sent).toEqual([]);expect(d.sender.errors).toEqual([]);expect(d.storage.read('messages','a')!.seenTurnId).toBeNull();d.storage.close();
});
it('first_sending_guard_runs_after_delay_outside_retry_catch',async()=>{
 const {d,request}=await ready();d.models.outputs.narrative=()=>{throw Error('interrupt');};await expect(new HdsiApp(d).runTurn(request)).rejects.toThrow('interrupt');const old=d.storage.unfinishedTurn()!;d.models.outputs.narrative=narrative;d.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'respond',draft:'old'},taskChanges:[]};d.models.outputs.expression={parts:[{kind:'text',content:'old'}]};const result=await generateTurn(d,request,old.id,old.at);const frozen=freezeTurn(d,old,result.candidate,result.items);d.storage.saveOutbox({...d.storage.outbox(old.id)[0],notBefore:new Date(Date.parse(d.clock.now())+1000).toISOString()});d.wait=async ms=>{d.clock.advance(ms);await append(d);};await expect(sendFrozen(d,frozen)).rejects.toThrow('superseded');expect(d.storage.outbox(old.id)[0].status).toBe('pending');expect(d.sender.sent).toEqual([]);d.storage.close();
});
it('silent_freeze_guard_is_inside_transaction',async()=>{
 const {d,request}=await ready();d.models.outputs.narrative=()=>{throw Error('interrupt');};await expect(new HdsiApp(d).runTurn(request)).rejects.toThrow('interrupt');d.models.outputs.narrative=narrative;const t=d.storage.unfinishedTurn()!,r=await generateTurn(d,request,t.id,t.at);await append(d);expect(()=>freezeTurn(d,t,r.candidate,r.items)).toThrow('superseded');expect(d.storage.read('post_jobs',t.id)).toBeNull();expect(d.storage.read('turns',t.id)!.outputComplete).toBe(false);d.storage.close();
});
