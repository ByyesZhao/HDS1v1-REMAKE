import {it,expect} from 'vitest';
import {buildExpressionView} from '../src/model/context-views';
import {initialCharacter} from '../src/config';
import {NOW} from './helpers';
it('draft_negation_commitment_time_actions_preserved; expression_not_given_autonomous_clock',()=>{
 const state=initialCharacter(NOW);state.sleep={sleepAt:NOW,wakeAt:'2026-10-08T08:00:00+08:00'};state.plan='不可发给表达的计划';state.nextAutonomousAt='2026-10-08T12:00:00+08:00';
 const intent={intention:'答复',draft:'我明天十点联系你，不去那里。',actions:['把杯子递给你']};
 const view=buildExpressionView({stage:'expression',input:{intent,mode:'shared_offline',state,chatExamples:'轻声说',history:{recent:[],details:[],shortTerm:[],longTerm:[],learned:[],detailHistory:[]}}});
 expect(view.context.intent).toEqual(intent);expect(view.context.mode).toBe('shared_offline');expect(JSON.stringify(view)).not.toContain('nextAutonomousAt');expect(JSON.stringify(view)).not.toContain('wakeAt');expect(JSON.stringify(view)).not.toContain('不可发给表达的计划');expect(JSON.stringify(view)).not.toContain('narratedUntil');
});
it('uncertain_pronoun_keeps_known_context_and_complete_recent_episode',()=>{
 const messages=Array.from({length:40},(_,i)=>({id:`m${i}`,receivedAt:NOW,direction:'incoming' as const,content:`那件事${i}`,seenTurnId:'seen',platformMessageIds:[],batchId:null,turnId:null,outboxSeq:null}));
 const view=buildExpressionView({stage:'expression',input:{intent:{intention:'回答',draft:'她明天会来，我不去。'},mode:'chat',history:{recent:messages,details:[],shortTerm:[],longTerm:[],learned:[],detailHistory:[{key:'x',previousValue:'旧',newValue:'新'}]},school:{knownSnapshots:[{value:{title:'已经知道的组会'}}]}}});
 expect(view.resources.messages).toHaveLength(40);expect(view.context.school).toEqual({knownSnapshots:[{value:{title:'已经知道的组会'}}]});expect(view.context.detailHistory).toHaveLength(1);
});
