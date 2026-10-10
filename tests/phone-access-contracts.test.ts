import {it,expect} from 'vitest';
import {narrativeTask} from '../src/model/contracts';
import {ModelClient,ModelFormatError} from '../src/model/client';
import {canRead} from '../src/host/state';
import {initialCharacter} from '../src/config';
import {NOW,narrative,setup} from './helpers';
import {makeSharedFixture} from './shared-v3-fixture';
import {selectSharedMeta} from '../src/host/shared';
const AT='2026-10-07T10:01:00+08:00';
const END='2026-10-07T10:10:00+08:00';
function selected(shared:boolean){
 if(!shared)return narrativeTask(false,NOW,AT);
 const d=setup();try{makeSharedFixture(d);return narrativeTask(true,NOW,AT,[],selectSharedMeta(d.storage,AT,[],[])!);}finally{d.storage.close();}
}
function output(shared:boolean,phoneAccess:boolean,expectedEndAt:string|null){
 return {...narrative,currentScene:{description:'当前活动',activity:{description:phoneAccess?'文献整理':'游泳',startsAt:NOW,phoneAccess,expectedEndAt}},...(shared?{publicNarration:'继续当前活动',progress:'继续',outline:{goal:'共同游泳',openThreads:[],endingCondition:'本次活动结束'},simulatedUserActions:[]}:{})};
}
it.each([false,true])('rejects inaccessible activity with no end, shared=%s',shared=>{
 expect(()=>selected(shared).parse(output(shared,false,null))).toThrow(/currentScene.activity.expectedEndAt/);
});
it.each([false,true])('rejects zero length inaccessible interval, shared=%s',shared=>{
 expect(()=>selected(shared).parse(output(shared,false,NOW))).toThrow(/currentScene.activity.expectedEndAt/);
});
it.each([false,true])('accepts finite inaccessible interval and readable open activity, shared=%s',shared=>{
 expect(selected(shared).parse(output(shared,false,END)).currentScene.activity?.phoneAccess).toBe(false);
 expect(selected(shared).parse(output(shared,true,null)).currentScene.activity?.expectedEndAt).toBeNull();
 const value=output(shared,true,null);value.currentScene.activity=null as any;
 expect(selected(shared).parse(value).currentScene.activity).toBeNull();
});
it('an expired finite restriction no longer prevents reading',()=>{
 const state=initialCharacter(AT);state.scene.activity={description:'洗澡',startsAt:NOW,expectedEndAt:AT,phoneAccess:false};
 expect(canRead(state,NOW)).toBe(false);expect(canRead(state,AT)).toBe(true);
});
it.each([false,true])('repairs missing end within the same task instead of guessing, shared=%s',async shared=>{
 const calls:any[]=[];const task=selected(shared);
 const client=new ModelClient({complete:async request=>{calls.push(request);return output(shared,false,calls.length===1?null:END);}});
 const result=await client.runModel(task,{at:AT});
 expect(result.currentScene.activity?.expectedEndAt).toBe(END);expect(calls).toHaveLength(2);
 expect(calls[1].repair.errors).toContain('currentScene.activity.expectedEndAt');
 expect(calls[1].repair.original.currentScene.activity.expectedEndAt).toBeNull();
 expect(calls[0].task.prompt).toBe(calls[1].task.prompt);
});
it.each([false,true])('fails after two repairs without changing phone access or inventing an end, shared=%s',async shared=>{
 const calls:any[]=[];const client=new ModelClient({complete:async request=>{calls.push(request);return output(shared,false,null);}});
 await expect(client.runModel(selected(shared),{at:AT})).rejects.toThrow(ModelFormatError);
 expect(calls).toHaveLength(3);expect(calls.slice(1).every(c=>c.repair.errors.includes('currentScene.activity.expectedEndAt'))).toBe(true);
});
