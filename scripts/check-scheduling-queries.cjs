const {captureQueries,plans}=require('./query-probe.cjs');
const assert=require('node:assert/strict');
const at='2026-10-07T02:00:00.000Z';
function runProbes(api){
 const {Storage,EnvironmentStore,SchoolStore,environmentDeadline,selectEnvironmentStepMetadata,createSchoolNoticeEvaluationContext,releaseSchoolNotices,selectSchoolNotices,schoolNoticeDeadline,schoolNotificationEligible}=api,results=[];
 for(const H of [0,90,180]){
  const s=new Storage(':memory:');try{s.set('runtime',{...s.runtime(),nextEnvironmentAt:'2026-10-08T02:00:00Z'});
   s.transaction(()=>{for(let i=0;i<=H;i++){const id=i===H?'current':'history'+i;s.save('environment_batches',id,{id,status:i===H?'active':'committed',timezone:'UTC',localDate:'2026-10-07',scheduledAt:at,createdAt:at,reason:'daily',closedAt:null});for(const stage of ['world','school_campus','school_group','school_week'])s.save('environment_steps',id+stage,{id:id+stage,batchId:id,stage,status:i===H?'pending':'committed',retryAt:null,inputSnapshot:{synthetic:'x'.repeat(1000+i*20)},frozenResult:{synthetic:'y'.repeat(1000+i*20)}});}});
   for(const [name,fn] of [['deadline',()=>environmentDeadline(s,at)],['metadata',()=>selectEnvironmentStepMetadata(s,at)],['batchSteps',()=>new EnvironmentStore(s).steps('current')]]){
    const observed=captureQueries(s,fn),rows=observed.queries.reduce((n,q)=>n+q.rows,0),json=observed.queries.reduce((n,q)=>n+q.jsonRows,0);
    assert.equal(observed.queries.length,name==='batchSteps'?1:name==='deadline'?3:2); // runtime state read is reported separately from two environment SELECTs
    assert.equal(observed.queries.filter(q=>/FROM environment_/.test(q.sql)).length,name==='batchSteps'?1:2);
    assert.equal(json,name==='batchSteps'?4:name==='deadline'?2:1); // two state/batch JSON rows, zero full step payloads
    assert.equal(observed.queries.filter(q=>/FROM environment_steps/.test(q.sql)).reduce((n,q)=>n+q.jsonRows,0),name==='batchSteps'?4:0);
    results.push({kind:'environment',H,name,rows,json,queries:observed.queries,plans:plans(s,observed.queries)});
   }
  }finally{s.close();}
 }
 const item=(id)=>({id,planId:'semester',owner:'campus',kind:'meeting',title:'合成班会',description:'合成',location:'学院',requirement:'required',issuedAt:at,timing:{kind:'once',startsAt:'2026-10-08T02:00:00Z',endsAt:'2026-10-08T03:00:00Z'},noticePolicy:{announceOnIssue:true,announceOnChange:true,reminders:[]},revision:1,deliveryRevision:1,status:'open',basis:'fiction',sourceUrls:[]});
 for(const H of [0,1000,5000])for(const A of [0,3]){
  const s=new Storage(':memory:');try{
   s.set('character',{scene:{mode:'chat',shared:null,activity:null},sleep:null});
   const first=item('one'),second=item('two'),instance={id:'instance',sourceItemId:first.id,sourceRevision:1,deliveryRevision:1,occurrenceKey:'synthetic',weekStart:null,startsAt:'2026-10-08T02:00:00Z',endsAt:'2026-10-08T03:00:00Z',sourceSnapshot:first,status:'active',needsExpansion:false,legacyEventId:null};
   const snapshot=value=>({entityKind:'plan_item',entityId:value.id,revision:1,value});
   const notice=(id,snapshots,channel='institution',kind='issue')=>({id,sourceItemId:null,instanceId:kind==='reminder'?'instance':null,weekStart:null,deliveryRevision:1,kind,reminderKey:kind,channel,publishAt:at,releasedAt:null,payload:{text:'合成通知',snapshots},status:'scheduled',nextWakeAt:at,readAt:null,readTurnId:null});
   s.transaction(()=>{
    for(let i=0;i<H;i++){const old=item('old'+i);s.save('school_plan_items',old.id,old);s.save('school_instances',old.id,{...instance,id:old.id,sourceItemId:old.id,sourceSnapshot:old});for(let j=0;j<3;j++)s.save('school_notices',old.id+j,{...notice(old.id+j,[snapshot(old)]),status:'read'});for(let j=0;j<2;j++)s.save('school_knowledge',old.id+j,{snapshot:snapshot(old),acquiredAt:at});}
    if(A){s.save('school_plan_items',first.id,first);s.save('school_plan_items',second.id,second);s.save('school_instances',instance.id,instance);s.save('school_notices','issue',notice('issue',[snapshot(first)]));s.save('school_notices','digest',notice('digest',[snapshot(first),snapshot(second)],'institution','week_digest'));s.save('school_notices','reminder',notice('reminder',[{entityKind:'instance',entityId:instance.id,revision:1,value:instance}],'personal_reminder','reminder'));s.save('school_knowledge','known-plan',{snapshot:snapshot(first),acquiredAt:at});s.save('school_knowledge','known-instance',{snapshot:{entityKind:'instance',entityId:instance.id,revision:1,value:instance},acquiredAt:at});}
   });
   const observed=captureQueries(s,()=>createSchoolNoticeEvaluationContext(s));assert.equal(observed.queries.length,A?5:1);assert.equal(observed.queries.reduce((n,q)=>n+q.jsonRows,0),A?8:0);
   const context=observed.value,consumers=captureQueries(s,()=>{releaseSchoolNotices(s,at,'UTC',context);return {refs:selectSchoolNotices(s,at,'UTC',context),eligible:schoolNotificationEligible(s,at,'UTC',context),deadline:schoolNoticeDeadline(s,at,'UTC',context)};});
   assert.equal(consumers.queries.filter(q=>/FROM school_/.test(q.sql)).length,0);assert.equal(consumers.queries.reduce((n,q)=>n+q.writes,0),A?3:0);
   assert.equal(consumers.value.refs.length,A);
   if(A&&H){s.transaction(()=>{for(let i=0;i<H;i++){s.save('school_knowledge','related-plan'+i,{snapshot:snapshot(first),acquiredAt:'2020-01-01T00:00:00Z'});s.save('school_knowledge','related-instance'+i,{snapshot:{entityKind:'instance',entityId:instance.id,revision:1,value:instance},acquiredAt:'2020-01-01T00:00:00Z'});}});const related=captureQueries(s,()=>new SchoolStore(s).latestKnownSnapshots([{entityKind:'plan_item',entityId:first.id},{entityKind:'instance',entityId:instance.id}]));assert.equal(related.queries.length,2);assert.equal(related.queries.reduce((n,q)=>n+q.jsonRows,0),2);assert.equal(related.value[0].value.id,first.id);results.push({kind:'relatedKnowledge',H,queries:related.queries,plans:plans(s,related.queries)});}
   const samples=[];for(let i=0;i<6;i++){const start=performance.now();createSchoolNoticeEvaluationContext(s);samples.push(performance.now()-start);}const hot=samples.slice(1).sort((a,b)=>a-b);
   results.push({kind:'school',H,A,queries:observed.queries,consumerQueries:consumers.queries,plans:plans(s,observed.queries),firstMs:samples[0],hotMs:samples.slice(1),medianMs:hot[2]});
  }finally{s.close();}
 }
 return {node:process.version,results};
}
exports.runProbes=runProbes;
if(require.main===module){
 const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--output')throw Error('Use --output <json>; no database input is accepted');
 const api={...require('../lib/environment/store'),...require('../lib/school/store'),...require('../lib/environment/scheduler'),...require('../lib/school/notices'),...require('../lib/storage')};
 const out=runProbes(api);require('node:fs').writeFileSync(args[1],JSON.stringify(out,null,2));process.stdout.write('Synthetic query assertions passed: '+out.results.length+' samples\n');
}
