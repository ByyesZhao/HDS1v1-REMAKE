import {it,expect} from 'vitest';
import {ChatCompletionsTransport,ModelRequestError} from '../src/model/client';
import {HdsiApp} from '../src/app';
import {SerialHost} from '../src/host/runtime';
import {setup,saveInput,NOW} from './helpers';
import {narrativeTask} from '../src/model/contracts';
const secret='private-input-and-key';
const connection={baseUrl:'https://example.invalid',apiKey:secret,model:'flash',reasoningEffort:'low' as const};
async function requestError(code:string,message:string,status=400){
 const transport=new ChatCompletionsTransport(()=>connection,async()=>new Response(JSON.stringify({error:{code,message}}),{status}) as never);
 try{await transport.complete({task:narrativeTask(false,NOW,NOW),input:{private:secret}});}catch(error){return error as ModelRequestError;}
 throw Error('expected HTTP failure');
}
it('known_context_limit_is_structured_without_provider_body',async()=>{
 const e=await requestError('context_length_exceeded',secret);expect(e).toMatchObject({kind:'context_limit',taskName:'narrative',httpStatus:400,providerCode:'context_length_exceeded'});expect(e.message).not.toContain(secret);
});
it('generic_400_not_assumed_capacity',async()=>{
 const e=await requestError('invalid_request_error',secret);expect(e.kind).toBe('request');expect(e.message).not.toContain(secret);
});
it('known_context_limit_pauses_with_scene_preserved; waiting_and_input_do_not_bypass_failed_turn; resume_same_load_may_fail_again_no_trim',async()=>{
 const d=setup();saveInput(d.storage,'a','input kept');const original=d.storage.character();const loads:unknown[]=[];
 const failure=await requestError('context_length_exceeded',secret);
 d.models.runModel=async(task,input)=>{loads.push(structuredClone(input));throw failure;};
 const app=new HdsiApp(d),host=new SerialHost(app,{timers:false});
 await expect(app.runTurn({inputMessageIds:['a'],taskIds:[],triggerKinds:['input']})).rejects.toBe(failure);
 const turn=d.storage.unfinishedTurn()!;expect(d.storage.character()).toEqual(original);expect(d.storage.runtime()).toMatchObject({paused:true,lastFailure:{kind:'context_limit',task:'narrative',stage:'generation',at:NOW}});
 expect(d.sender.errors[0]).toContain('生成');expect(d.sender.errors[0]).toContain('暂停');expect(JSON.stringify(d.sender.errors)).not.toContain(secret);expect(await host.status()).toContain('context_limit');
 d.clock.advance(16*60000);await host.acceptInput({id:'later',receivedAt:d.clock.now(),content:'new message'});await host.wake();expect(loads).toHaveLength(1);expect(d.storage.unfinishedTurn()!.id).toBe(turn.id);
 await host.resume();expect(loads).toHaveLength(2);expect(d.storage.runtime().paused).toBe(true);
 // This reproduction intentionally has no new visible input on the old turn. Its original source is retained on retry.
 for(const load of loads as any[])expect(load.resources.messages.some((m:any)=>m.id==='a')).toBe(false); // ordinary narrative never sees unread input
 expect(d.storage.read('messages','a')!.content).toBe('input kept');expect(d.storage.read('messages','later')!.seenTurnId).toBeNull();await host.stop();d.storage.close();
});
it('postprocessing_error_keeps_confirmed_output_and_safe_notification',async()=>{
 const d=setup();saveInput(d.storage,'a','hello');d.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'reply',draft:'confirmed'},taskChanges:[]};d.models.outputs.expression={parts:[{kind:'text',content:'confirmed'}]};
 const original=d.models.runModel.bind(d.models);d.models.runModel=async(task,input,opts)=>{if(task.name==='memory')throw Error(secret);return original(task,input,opts);};
 await expect(new HdsiApp(d).runTurn({inputMessageIds:['a'],taskIds:[],triggerKinds:['input']})).rejects.toThrow(secret);
 expect(d.storage.runtime()).toMatchObject({paused:true,lastFailure:{kind:'error',stage:'postprocessing'}});expect(d.storage.unfinishedTurn()!.outputComplete).toBe(true);expect(d.storage.outbox(d.storage.unfinishedTurn()!.id)[0].status).toBe('confirmed');expect(d.sender.sent[0].payload).toBe('confirmed');expect(d.sender.errors[0]).toContain('后处理');expect(JSON.stringify(d.storage.runtime().lastFailure)).not.toContain(secret);expect(JSON.stringify(d.sender.errors)).not.toContain(secret);d.storage.close();
});
