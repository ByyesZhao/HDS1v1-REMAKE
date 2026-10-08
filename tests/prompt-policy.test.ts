import { it,expect } from 'vitest';
import { ModelClient,ChatCompletionsTransport } from '../src/model/client';
import { personalTask,narrativeTask } from '../src/model/contracts';
import { stageInput } from '../src/model/context-views';
import { NOW } from './helpers';
import type { SharedTurnMeta } from '../src/types';
it('contact_ineligible_true_rejected_and_repaired and eligible_false_still_legal',async()=>{
 const task=personalTask('life',NOW,[],'chat',[],undefined,undefined,{contactEligible:false});const requests:any[]=[];const yes={innerThought:'想分享',emotions:[],contact:{willing:true,intention:'联系',draft:'你好'}};const no={innerThought:'休息',emotions:[],contact:{willing:false}};
 expect(()=>task.parse(yes)).toThrow();const result=await new ModelClient({complete:async r=>{requests.push(r);return requests.length===1?yes:no;}}).runModel(task,stageInput('personal_life',{contactEligible:false}),{lookup:null});expect(result).toMatchObject(no);expect(requests).toHaveLength(2);expect(requests[1].repair).toBeDefined();expect(()=>personalTask('life',NOW,[],'chat',[],undefined,undefined,{contactEligible:true}).parse(no)).not.toThrow();
});
it('opening_final_both_rules and frozen permission stays across lookup and repair',async()=>{
 const meta:SharedTurnMeta={activityId:'a',stepNumber:1,maxSteps:1,idleSeconds:60,advanceReason:'automatic',phase:'final',controlRequestIds:[],sceneTaskId:'scene:a',allowSimulatedUserActions:true};const task=narrativeTask(true,NOW,NOW,[],meta);expect(task.prompt).toContain('本轮必须公开开场');expect(task.prompt).toContain('本轮必须公开收尾');expect(task.prompt).toContain('允许代写双方');
 const bodies:any[]=[];let n=0;const transport=new ChatCompletionsTransport(()=>({baseUrl:'https://example.test',apiKey:'offline',model:'deepseek-flash'}),(async(_u,o)=>{bodies.push(JSON.parse(String(o?.body)));const result=++n===1?{lookupDetails:'地点'}:n===2?{}:{experiences:[],currentScene:{description:'结束',activity:null},energy:{level:'正常',reason:'休息'},publicNarration:'活动开始并自然结束',progress:'结束',outline:{goal:'活动',openThreads:[],endingCondition:'结束'},simulatedUserActions:[]};return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}));}) as typeof fetch);
 await new ModelClient(transport).runModel(task,stageInput('narrative_shared',{sharedMeta:meta}),{lookup:async()=>{meta.allowSimulatedUserActions=false;return {place:'门口'};}});expect(bodies).toHaveLength(3);for(const body of bodies)expect(body.messages[0].content).toContain('允许代写双方');expect(bodies[2].messages[0].content).not.toContain('可先只返回');
});

import {applicableResourceRules} from '../src/model/prompt-policy';
it('resource role guide distinguishes current input from history without exposing absent roles',()=>{
 const view=stageInput('personal_shared',{visibleMessages:[{id:'new',content:'我仍在店外',direction:'incoming',receivedAt:NOW,seenTurnId:null,turnId:null,outboxSeq:null,batchId:null,platformMessageIds:[]}],history:{recent:[]}});
 const rules=applicableResourceRules(view,'personal_shared',false,false);
 expect(rules).toContain('resources');expect(rules).toContain('roles.visibleIds');expect(rules).toContain('纠正');expect(rules).not.toContain('currentSourceIds');
 const memory=stageInput('memory',{experiences:[{id:'exp'}],visibleMessages:[]});
 expect(applicableResourceRules(memory,'memory',false,false)).toContain('roles.currentSourceIds');
});
