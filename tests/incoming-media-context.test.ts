import {it,expect} from 'vitest';import {stageInput} from '../src/model/context-views';import {hydrateVisualContext,withTurnVisualContext} from '../src/input-media/context';import {buildCompletionEnvelope} from '../src/model/resource-pool';
const message={id:'m',content:'A B A',direction:'incoming',receivedAt:'2026-10-09T10:00:00Z',seenTurnId:'old',contentParts:[{kind:'attachment',attachmentId:'a',start:0,end:1}]} as any;
const observations=['a','b','c'].map((attachmentId,order)=>({messageId:'m',attachmentId,order,status:'ready',origin:'vision',observationRef:order===1?'B':'A',recognizerVersion:'v1',observation:{description:order===1?'乙':'甲',visibleText:[],possibleTone:null,uncertain:false}})) as any;
it('hydrates final permitted pools, ABA positions, single bodies, frozen unknown override',()=>{
 const view=stageInput('narrative',{recent:[message]});const hydrated=hydrateVisualContext(view,observations,[]);
 expect(hydrated.resources.messages[0].visualAttachments!.map(a=>a.observationRef)).toEqual(['A','B','A']);expect(hydrated.resources.visualObservations).toHaveLength(2);
 const unknown={...observations[0],status:'unrecognized',origin:'unavailable',observationRef:null,recognizerVersion:null,observation:null};
 expect(hydrateVisualContext(view,observations,[unknown]).resources.messages[0].visualAttachments![0].status).toBe('unrecognized');
 expect(hydrateVisualContext(stageInput('narrative',{recent:[{...message,seenTurnId:null}]}),observations,[]).resources.visualObservations).toHaveLength(0);
});
it('hydrated lookup DTO merges into envelope and does not add historical memory sources',async()=>{
 let captured:any;const runner={async runModel(_t:any,input:any,options:any){captured={input,lookup:await options.lookup('cat')};return {} as any;}};
 const media={readConfirmedForMessages:()=>observations,readFrozenForTurn:()=>[]};
 const wrapped=withTurnVisualContext(runner,media as any,'t');await wrapped.runModel({name:'memory'} as any,stageInput('memory',{visibleMessages:[]}),{lookup:async()=>({recent:[message]})});
 const envelope=buildCompletionEnvelope({task:{name:'memory'} as any,input:captured.input,lookupResult:captured.lookup});
 expect(envelope.resources.visualObservations).toHaveLength(2);expect(envelope.resources.messages[0].visualAttachments).toHaveLength(3);expect(captured.lookup.roles.currentSourceIds).not.toContain('m');
});
