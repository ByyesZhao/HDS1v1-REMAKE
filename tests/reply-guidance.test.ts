import {expect,it} from 'vitest';
import {ChatCompletionsTransport,ModelClient} from '../src/model/client';
import {runPersonal} from '../src/directors/personal';
import {runExpression} from '../src/output/expression';
import {NOW,silent,setup} from './helpers';
import {InputBuffer} from '../src/host/input';
import {HdsiApp} from '../src/app';
import type {Message,SharedTurnMeta} from '../src/types';

const message=(id:string,direction:Message['direction']='incoming',visual=false):Message=>({id,direction,content:'当前消息',receivedAt:NOW,platformMessageIds:[],batchId:null,seenTurnId:null,turnId:null,outboxSeq:null,...(visual?{hasVisualAttachment:true}:{})});
const meta:SharedTurnMeta={activityId:'a',stepNumber:2,maxSteps:20,idleSeconds:60,advanceReason:'automatic',phase:'ongoing',controlRequestIds:[],sceneTaskId:'scene:a',allowSimulatedUserActions:false};
function client(results:unknown[]) {
 const bodies:any[]=[];
 const transport=new ChatCompletionsTransport(()=>({baseUrl:'https://offline.test',apiKey:'synthetic',model:'deepseek-flash'}),(async(_url,options)=>{
  bodies.push(JSON.parse(String(options?.body)));
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(results.shift())}}]}));
 }) as typeof fetch);
 return {models:new ModelClient(transport),bodies};
}
async function run(stage:'chat'|'shared'|'life'|'expression',models:ModelClient,input:object) {
 if(stage==='expression')return runExpression(models,{intent:{intention:'回答',draft:'知道啦～'},mode:'chat',...input});
 return runPersonal(models,stage,NOW,[],stage==='shared'?'shared_online':'chat',['v','r'],input,{lookup:null},stage==='shared'?meta:undefined,null,{contactEligible:false});
}
const replyResult=(stage:string)=>stage==='expression'?{parts:[{kind:'text',content:'知道啦～'}]}:stage==='life'?{innerThought:'休息',emotions:[],contact:{willing:false}}:silent;

// Catches omission or repeated injection at the actual provider boundary, including repair.
it.each(['chat','shared','life','expression'] as const)('%s sends the three reply rules once on first request and repair',async stage=>{
 const {models,bodies}=client([{},replyResult(stage)]);
 await run(stage,models,{visibleMessages:[message('v')]});
 expect(bodies).toHaveLength(2);
 for(const body of bodies){const system=body.messages[0].content;
  for(const rule of ['回应对方想表达的意思','通常不是在申请批准','标点、重复字、短片段和气泡分段'])expect(system.split(rule)).toHaveLength(2);
  expect(system).not.toContain('普通狗的图片不等于狗头');
 }
});

// Current input and explicit deferred reconsideration qualify; historical/outgoing images do not.
it.each([
 ['visible',{visibleMessages:[message('v','incoming',true)]},true],
 ['reconsider',{reconsiderMessages:[message('r','incoming',true)]},true],
 ['history',{history:{recent:[message('old','incoming',true)]},visibleMessages:[message('v')]},false],
 ['activity-history',{currentActivityMessages:[message('old','incoming',true)],visibleMessages:[message('v')]},false],
 ['outgoing',{visibleMessages:[message('v','outgoing',true)]},false],
 ['words-only',{visibleMessages:[{...message('v'),content:'这个表情包很好玩，普通狗图片也可爱'}]},false],
] as const)('%s selects the visual reply branch only from relevant user input',async(_name,input,expected)=>{
 for(const stage of ['chat','expression'] as const){const {models,bodies}=client([replyResult(stage)]);await run(stage,models,input);
  const system=bodies[0].messages[0].content;expect(system.includes('普通狗的图片不等于狗头')).toBe(expected);
  if(expected){expect(system).toContain('同批后续有实质文字时要整批理解');expect(system).toContain('未识别');}
 }
});

it('visual decision and style survive lookup then format repair without copying message bodies',async()=>{
 const bodies:any[]=[];const input={visibleMessages:[{...message('v','incoming',true),content:'（用户发送表情包，未识别内容）'}, {...message('r'),content:'其实是想跟你说今天的事'}]};
 const results=[{lookupDetails:'今天'}, {},silent];
 const models=new ModelClient(new ChatCompletionsTransport(()=>({baseUrl:'https://offline.test',apiKey:'synthetic',model:'deepseek-flash'}),(async(_url,options)=>{bodies.push(JSON.parse(String(options?.body)));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(results.shift())}}]}));}) as typeof fetch));
 const result=await runPersonal(models,'chat',NOW,[],'chat',['v','r'],input,{lookup:async()=>{(input.visibleMessages[0] as any).hasVisualAttachment=false;return {known:'本地事实'};}});
 expect(result).toEqual(silent);expect(bodies).toHaveLength(3);
 for(const body of bodies){expect(body.messages[0].content).toContain('普通狗的图片不等于狗头');expect(body.messages[0].content).toContain('reply.decision=none');
  const envelope=JSON.parse(body.messages[1].content);expect(envelope.resources.messages.map((m:Message)=>m.id)).toEqual(['v','r']);expect(envelope.resources.messages[0].hasVisualAttachment).toBe(true);
 }
});

it('image-only reply none completes the real turn, marks the message seen, and sends nothing',async()=>{
 const d=setup();
 try{
  const buffer=new InputBuffer(d.storage);
  await buffer.acceptInput({id:'visual',receivedAt:NOW,content:'（用户发送表情包，未识别内容）',hasVisualAttachment:true});
  d.clock.advance(16000);buffer.closeReady(d.clock.now());
  await new HdsiApp(d).runTurn({inputMessageIds:['visual'],batchIds:d.storage.runtime().pendingBatchIds,taskIds:[],triggerKinds:['input']});
  expect(d.storage.read('messages','visual')?.seenTurnId).not.toBeNull();expect(d.storage.unfinishedTurn()).toBeNull();
  expect(d.sender.sent).toEqual([]);expect(d.sender.errors).toEqual([]);
  expect(d.models.calls.map(c=>c.name)).toEqual(['narrative','personal_chat','memory']);
 }finally{d.storage.close();}
});
