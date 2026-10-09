const {performance}=require('node:perf_hooks');
const stages=['world','school_campus','school_group','school_week'];
function parseEnvelopeRequest(init){
 const envelope=JSON.parse(JSON.parse(init.body).messages[1].content);
 const context=envelope.input?.context,roles=envelope.input?.roles;
 if(!context||!stages.includes(context.stage)||!roles||!envelope.resources)throw Error('invalid current environment envelope');
 return {envelope,context,stage:context.stage};
}
function mockEnvironmentResponse(context,scenario){
 const stage=context.stage;
 if(stage==='world')return {changes:[]};
 if(stage==='school_week')return {stage,noticeTexts:context.notices.map(n=>({key:n.key,text:'离线通知：'+n.title})),weekNotes:context.weekStarts.map(weekStart=>({weekStart,conflictNotes:[]}))};
 const owner=stage==='school_campus'?'campus':'group';
 const itemChanges=scenario==='required_notice'&&owner==='campus'?[{action:'create',clientRef:'meeting',item:{planId:owner,owner,kind:'meeting',title:'离线班会',description:'离线验收通知',location:'学院',requirement:'required',issuedAt:context.at,timing:{kind:'once',startsAt:'2026-10-09T03:00:00Z',endsAt:'2026-10-09T04:00:00Z'},noticePolicy:{announceOnIssue:true,announceOnChange:true,reminders:[]},status:'open',basis:'fiction',sourceUrls:[]}}]:[];
 return {stage,planChanges:[{action:'create',clientRef:owner,plan:{owner,kind:owner==='campus'?'semester':'group',title:'offline plan',startsOn:'2026-09-01',endsOn:null,summary:'offline',status:'active'}}],itemChanges};
}
async function waitForEnvironmentBatch(inspect,batchId,deadline){
 let captured=batchId;
 while(performance.now()<deadline){
  const snapshot=inspect(captured);
  captured??=snapshot.batch?.id;
  const {batch,steps=[],paused}=snapshot;
  if(batch?.status==='committed'&&steps.length===4&&stages.every(stage=>steps.some(s=>s.stage===stage&&s.status==='committed')))return snapshot;
  if(paused||batch?.status==='superseded'||steps.some(s=>s.lastError||s.status==='superseded'))throw Error('environment failed: '+JSON.stringify(snapshot));
  await new Promise(resolve=>setImmediate(resolve));
 }
 throw Error('environment timeout: '+JSON.stringify(inspect(captured)));
}
async function runScenario(scenario){return require('./plugin-smoke.cjs').runScenario(scenario);}
module.exports={parseEnvelopeRequest,mockEnvironmentResponse,waitForEnvironmentBatch,runScenario};
