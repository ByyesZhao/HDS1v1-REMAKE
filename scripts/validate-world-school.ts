import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {acceptancePaths,withRequestTimeout,isolatedResumePath} from './world-school-acceptance-safety';
import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {EnvironmentStore} from '../src/environment/store';
import {SchoolStore} from '../src/school/store';
import {HdsiApp} from '../src/app';
import {SerialHost} from '../src/host/runtime';
import {Scheduler} from '../src/host/scheduler';
import {InputBuffer} from '../src/host/input';
import {ModelClient,ChatCompletionsTransport} from '../src/model/client';
import {loadSettings,appConfig,initialState,connectionFor,modelRoles} from '../src/settings';
import {generateEnvironmentStep} from '../src/directors/school';
import {resolveSchoolWeek,schoolExpansionInput,resolveSchoolWeekText} from '../src/school/calendar';
import {applySchoolChanges,resolveSchoolUpstream} from '../src/school/changes';
import {releaseSchoolNotices} from '../src/school/notices';
import {personalSchoolContext} from '../src/school/context';
import {sharedStorySeed} from './shared-story-seed';
import type {EnvironmentStepInput} from '../src/environment/types';
import type {SchoolPlanItem} from '../src/school/types';
import type {ModelRunner,ModelTask,OutboxItem} from '../src/types';
import type {ModelRunOptions} from '../src/memory/types';

// Read only local configuration/background. Formal SQLite, QQ, images and embedding
// providers are never opened here. Offline mode does not load local credentials.
async function main(){
 const args=process.argv.slice(2),offline=args.includes('--offline');
 const value=(flag:string,fallback:string)=>args.includes(flag)?args[args.indexOf(flag)+1]:fallback;
 const projectRoot=resolve(value('--project-root','D:/HDSI-remake'));
 const scenario=value('--scenario','all');if(!['all','stories','continue','feedback'].includes(scenario))throw Error('unknown acceptance scenario');
 const timeoutMs=Number(value('--timeout-ms','300000'));
 const paths=acceptancePaths(projectRoot,`${offline?'offline':'online'}-${randomUUID()}`);
 mkdirSync(paths.root,{recursive:true});console.log(`Acceptance artifacts: ${paths.root}`);
 // Continuation copies only a previously isolated database, never formal SQLite.
 if(scenario==='continue'||scenario==='feedback'){
  const from=isolatedResumePath(projectRoot,value('--resume',''));
  const prior=new Storage(from);prior.prepare('VACUUM INTO ?').run(paths.database);prior.close();
 }
 const storage=new Storage(paths.database),schoolStore=new SchoolStore(storage),environmentStore=new EnvironmentStore(storage);
 const formalPath=join(projectRoot,'runtime','data','hdsi-remake.sqlite');
 const formalHash=()=>existsSync(formalPath)?createHash('sha256').update(readFileSync(formalPath)).digest('hex'):null;
 const formalBefore=formalHash();
 const scenarioItem=(patch:Partial<SchoolPlanItem>):SchoolPlanItem=>({id:'meeting',planId:'semester',owner:'campus',kind:'meeting',title:'验收班会',description:'模拟通知要求参加，角色仍可选择不去',location:'学院旧教室',requirement:'required',issuedAt:'2026-10-09T06:00:00+08:00',timing:{kind:'once',startsAt:'2026-10-10T11:30:00+08:00',endsAt:'2026-10-10T12:00:00+08:00'},noticePolicy:{announceOnIssue:true,announceOnChange:true,reminders:[{kind:'local_days_before',offset:1,source:'institution'},{kind:'minutes_before',offset:120,source:'institution'}]},revision:1,deliveryRevision:1,status:'open',basis:'fiction',sourceUrls:[],...patch});
 const seeds=[scenarioItem({}),scenarioItem({id:'course',kind:'course',title:'可选科研方法课',requirement:'optional',timing:{kind:'weekly',startsOn:'2026-10-09',endsOn:'2027-01-20',slots:[{slotKey:'mon-am',weekday:1,start:'09:00',end:'10:00'}]},noticePolicy:{announceOnIssue:true,announceOnChange:true,reminders:[{kind:'minutes_before',offset:60,source:'institution'}]}}),scenarioItem({id:'research',planId:'group-plan',owner:'group',kind:'research',title:'下月模拟研究汇报',description:'从已有研究方向的一小段材料开始，先读一页文献并记下问题，导师后续可以给出反馈。没有要求完成整个课题。',responsible:'角色本人',deliverable:'模拟阶段阅读笔记',timing:{kind:'deadline',at:'2026-11-15T17:00:00+08:00',date:null,note:'下月的长期截止'}}),scenarioItem({id:'draft',title:'未来尚未下发草案',issuedAt:'2026-10-15T09:00:00+08:00',timing:{kind:'once',startsAt:'2026-10-20T14:00:00+08:00',endsAt:'2026-10-20T15:00:00+08:00'}})];
 const evidence:any[]=[];
 const dump=(label:string)=>{const row={label,at:now,character:storage.get('character'),plans:schoolStore.plans(),items:schoolStore.items(),instances:schoolStore.instances(),notices:schoolStore.notices(),knowledge:schoolStore.knowledge(),progress:schoolStore.progress(),turns:storage.all('turns'),experiences:storage.all('experiences'),runtime:storage.runtime()};evidence.push(row);writeFileSync(join(paths.root,'evidence.json'),JSON.stringify(evidence,null,2));};
 let now='2026-10-09T06:00:00+08:00';
 if(offline){
  for(const i of seeds)storage.save('school_plan_items',i.id,i);
  const input=schoolExpansionInput(storage,now,'Asia/Shanghai');
  assert(input.weekStarts.includes('2026-10-12'));assert(input.requiredNoticeKeys.some(n=>n.sourceItemId==='research'&&n.kind==='issue'));
  assert(input.requiredNoticeKeys.find(n=>n.sourceItemId==='draft'&&n.kind==='issue')!.publishAt==='2026-10-15T09:00:00+08:00');
  writeFileSync(join(paths.root,'offline.json'),JSON.stringify({offline:true,modelRequests:0,qqSends:0,seeds,input,timeoutMs},null,2));
  storage.close();assert.equal(formalHash(),formalBefore);
  console.log('Offline path/calendar checks passed; zero model or QQ requests.');return;
 }
 const settings=loadSettings(join(projectRoot,'config.local.json'));
 const cfg={...appConfig(settings),stickersEnabled:false,schoolSetting:settings.schoolSetting+'\n本次是隔离验收的最小建档范围：校园建立持续学期计划，最多安排一门可选周一课；课题组建立持续计划及一个小型模拟研究要求。已有稳定计划通常只做空增量检查，不另造大型事件。'};
 const calls:any[]=[],outputs:any[]=[],sent:OutboxItem[]=[];let label='bootstrap',host:SerialHost|undefined;
 const sanitize=(input:unknown)=>JSON.parse(JSON.stringify(input,(key,value)=>['background','chatExamples'].includes(key)?'[local background omitted from artifact]':value));
 const transport=withRequestTimeout(new ChatCompletionsTransport(task=>connectionFor(settings,task)),timeoutMs);
 const client=new ModelClient({complete:async(request,options)=>{
  const record:any={number:calls.length+1,label,task:request.task.name,repair:!!request.repair,repairErrors:request.repair?.errors,startedAt:new Date().toISOString(),input:sanitize(request.input),lookup:sanitize(request.lookupResult??null)};calls.push(record);
  console.log(`${record.number} ${label} ${record.task}${record.repair?' repair':''}`);
  const started=Date.now();try{const raw=await transport.complete(request,options);record.raw=raw;return raw;}catch(error){record.error=error instanceof Error?error.message:String(error);throw error;}
  finally{record.elapsedMs=Date.now()-started;writeFileSync(join(paths.root,'calls.json'),JSON.stringify(calls,null,2));console.log(`${record.number} completed in ${record.elapsedMs}ms${record.error?' (failure)':''}`);}
 }});
 const models:ModelRunner={async runModel<T>(task:ModelTask<T>,input:unknown,options?:ModelRunOptions){const result=await client.runModel(task,input,options);outputs.push({label,task:task.name,result});writeFileSync(join(paths.root,'outputs.json'),JSON.stringify(outputs,null,2));return result;}};
 const clock={now:()=>now},memoryStore=new MemoryStore(storage);memoryStore.migrate(now);
 for(const detail of settings.initialDetails)memoryStore.saveOwner(memoryStore.makeOwner({ownerType:'detail',ownerId:detail.key},{...detail,content:detail.value},now));
 const app=new HdsiApp({storage,environmentStore,schoolStore,clock,models,config:cfg,memoryStore,random:{next:()=>0.5},sender:{async sendItem(item){sent.push(structuredClone(item));return {platformMessageIds:[`test-${randomUUID()}`]};},async sendError(message){outputs.push({label,error:message});}},wait:async ms=>{now=new Date(Date.parse(now)+ms).toISOString();}});
 app.dependencies.generateEnvironment=input=>generateEnvironmentStep(app.dependencies,input);
 const resetState=(plan:string,description='宿舍书桌前，手机可用')=>{
  for(const task of storage.all('tasks').filter(t=>t.kind==='scene_step'&&t.status==='pending'))storage.save('tasks',task.id,{...task,status:'completed'});
  storage.set('character',{...initialState(settings,now),sleep:null,narratedUntil:now,nextAutonomousAt:'2099-01-01T00:00:00Z',plan,scene:{mode:'chat',shared:null,description,activity:null}});
  storage.set('runtime',{...storage.runtime(),paused:false,sharedClock:null,nextEnvironmentAt:'2099-01-01T00:00:00Z'});
 };
 const week=async(name:string)=>{
  label=name;const input:EnvironmentStepInput={stage:'school_week',batchId:`acceptance-${name}`,at:now,context:{...schoolExpansionInput(storage,now,cfg.timezone),timezone:cfg.timezone,appointments:[]}};
  const result=await generateEnvironmentStep(app.dependencies,input);assert(result.stage==='school_week');
  storage.transaction(()=>applySchoolChanges(storage,input.modelContractVersion===1?resolveSchoolWeekText(storage,result as import('../src/environment/types').SchoolWeekTextResult,input.context as any,now):resolveSchoolWeek(storage,result as import('../src/environment/types').LegacySchoolWeekResult,input.context as any,now),now));dump(name);
 };
 const story=async(name:string,advanceMinutes:number,message?:string)=>{
  label=name;now=new Date(Date.parse(now)+advanceMinutes*60000).toISOString();
  if(message){await new InputBuffer(storage).acceptInput({id:randomUUID(),receivedAt:now,content:message});now=new Date(Date.parse(now)+16_000).toISOString();}
  const scheduler=new Scheduler(storage,cfg);const request=await scheduler.collectReady(now);assert(request&&!request.environmentStepId,`no story selected: ${name}`);
  await app.runTurn(request);assert(!storage.runtime().paused);assert(!storage.unfinishedTurn());dump(name);
 };
 let failure:string|null=null;
 try{
  if(scenario==='feedback'){
   now='2026-10-12T10:00:00+08:00';resetState('现在正与既有导师讨论此前已经发出的阅读笔记；仅在实际交流发生后记录反馈。','已按自己的计划和背景中既有导师开始讨论阅读笔记，交流正在进行');
   storage.set('character',{...storage.character(),scene:{...storage.character().scene,activity:{description:'与既有导师讨论已经发出的模拟阅读笔记',startsAt:now,expectedEndAt:'2026-10-12T10:15:00+08:00',phoneAccess:true}},nextAutonomousAt:'2026-10-12T10:15:00+08:00'});
   dump('feedback-start-fixture');await story('mentor-live-discussion',16);
   assert(schoolStore.progress().some(p=>p.kind==='feedback'),'no actual mentor feedback generated');
  }else{
  if(scenario==='all'){
  resetState('起床前的环境建档，不是角色已经知道学校安排');storage.set('runtime',{...storage.runtime(),nextEnvironmentAt:null});
  host=new SerialHost(app,{timers:false,onError:error=>{throw error;}});await host.start();await host.stop();host=undefined;
  assert(environmentStore.steps().filter(s=>s.status==='committed').length===4,'initial environment chain incomplete');
  dump('actual-directors-bootstrap');const plansBefore=schoolStore.plans(),itemsBefore=schoolStore.items();
  now='2026-10-10T06:00:00+08:00';label='second-day';resetState('昨日计划有效，今天仅复核');storage.set('runtime',{...storage.runtime(),nextEnvironmentAt:now});
  host=new SerialHost(app,{timers:false,onError:error=>{throw error;}});await host.start();await host.stop();host=undefined;dump('actual-second-day');
  writeFileSync(join(paths.root,'plan-reuse.json'),JSON.stringify({before:plansBefore,after:schoolStore.plans(),itemsBefore,itemsAfter:schoolStore.items()},null,2));
  storage.prepare('VACUUM INTO ?').run(join(paths.root,'bootstrap.sqlite'));
  }
  // Explicit test fixtures start a separate database phase. Original model results
  // remain in calls/outputs/evidence; fixture rows are never claimed as LLM output.
  if(scenario!=='continue'){
  storage.transaction(()=>{for(const table of ['school_plans','school_plan_items','school_instances','school_notices','school_knowledge','school_progress','school_weeks','tasks','messages','experiences','turns','outbox','post_jobs','memories','memory_retention_grants','memory_index_jobs','memory_maintenance_jobs','memory_awakenings','learned_background'] as const)storage.prepare(`DELETE FROM ${table}`).run();});
  now='2026-10-09T09:00:00+08:00';resetState('角色已经决定把眼前公开通知读完，再选择今日安排；未知草案不能预知','起床后的宿舍，正在主动查看手机中的学院与导师公开通知');
  storage.set('character',{...storage.character(),scene:{...storage.character().scene,activity:{description:'主动阅读已下发的学院与导师通知',startsAt:now,expectedEndAt:'2026-10-09T09:10:00+08:00',phoneAccess:true}}});
  storage.save('school_plans','semester',{id:'semester',owner:'campus',kind:'semester',title:'验收学期',startsOn:'2026-09-01',endsOn:'2027-01-20',summary:'固定测试起点',revision:1,status:'active'});
  storage.save('school_plans','group-plan',{id:'group-plan',owner:'group',kind:'group',title:'验收课题组',startsOn:'2026-09-01',endsOn:null,summary:'沿用实际背景中的导师身份',revision:1,status:'active'});
  for(const i of seeds)storage.save('school_plan_items',i.id,i);
  writeFileSync(join(paths.root,'fixture-seeds.json'),JSON.stringify(seeds,null,2));
  await week('friday-expand');
  const mondayCourse=schoolStore.instances().find(i=>i.sourceItemId==='course'&&i.weekStart==='2026-10-12')!;assert(mondayCourse);
  // Simulate the host rescan at publication, then allow real elapsed reading
  // time. Publishing only at the final instant gives no prior reading interval.
  storage.transaction(()=>releaseSchoolNotices(storage,now));
  await story('read-initial-notices',15);
  const initialKnown=personalSchoolContext(storage,[],'').knownSnapshots;assert(!initialKnown.some(s=>s.entityId==='draft'));
  // The old-read prerequisite must come from actual observed knowledge.
  const oldMeeting=initialKnown.find(s=>s.entityKind==='plan_item'&&s.entityId==='meeting');
  if(!oldMeeting)throw Error('model did not read meeting; old-known correction case requires a targeted rerun');
  const correction=resolveSchoolUpstream(storage,{stage:'school_campus',planChanges:[],itemChanges:[{action:'update',id:'meeting',expectedRevision:1,item:{location:'学院新教室',timing:{kind:'once',startsAt:'2026-10-10T13:00:00+08:00',endsAt:'2026-10-10T14:00:00+08:00'}}},{action:'update',id:'draft',expectedRevision:1,item:{location:'未来草案新地点'}}]},now);
  const researchChange=resolveSchoolUpstream(storage,{stage:'school_group',planChanges:[],itemChanges:[{action:'update',id:'research',expectedRevision:1,item:{timing:{kind:'deadline',at:'2026-11-16T17:00:00+08:00',date:null,note:'模拟长期截止改期'}}}]},now);
  storage.transaction(()=>{applySchoolChanges(storage,correction,now);applySchoolChanges(storage,researchChange,now);});
  }
  else{now=storage.character().narratedUntil;dump('continued-from-isolated-failure');}
  const oldMeeting=personalSchoolContext(storage,[],'meeting').knownSnapshots.find(s=>s.entityKind==='plan_item'&&s.entityId==='meeting')!;
  const mondayCourse=schoolStore.instances().find(i=>i.sourceItemId==='course'&&i.weekStart==='2026-10-12')!;
  await week('issued-reschedule-future-draft');
  releaseSchoolNotices(storage,now);
  assert(schoolStore.notices().some(n=>n.sourceItemId==='meeting'&&n.kind==='change'&&n.status==='available'));
  assert(schoolStore.notices().some(n=>n.sourceItemId==='research'&&n.kind==='change'&&n.status==='available'));
  assert(schoolStore.notices().filter(n=>n.sourceItemId==='draft'&&n.status!=='invalidated').every(n=>n.status==='scheduled'));
  assert.equal(personalSchoolContext(storage,[],'meeting').knownSnapshots.find(s=>s.entityId==='meeting')!.revision,oldMeeting.revision);dump('published-but-old-knowledge');
  storage.set('character',{...storage.character(),plan:'先洗澡，不能看手机；出来后可以阅读通知，也可以选择不参加班会。',scene:{mode:'chat',shared:null,description:'正在洗澡，手机留在浴室外',activity:{description:'洗澡',startsAt:now,expectedEndAt:new Date(Date.parse(now)+20*60000).toISOString(),phoneAccess:false}}});
  const during=await new Scheduler(storage,cfg).collectReady(now);assert.equal(during,null);dump('bath-defers-unread');
  await story('after-bath-correction',21);
  // Reminders: day-before and two-hours are checked on the revised meeting.
  const reminders=schoolStore.notices().filter(n=>n.sourceItemId==='meeting'&&n.kind==='reminder'&&n.deliveryRevision===2);assert.equal(reminders.length,2);
  now='2026-10-09T13:00:00+08:00';resetState('读到班会通知后可自由选择不参加，不必按required强制执行。');await story('day-before-reminder',1);
  now='2026-10-10T11:00:00+08:00';resetState('不想参加下午班会，考虑留在宿舍休息。');await story('two-hour-reminder-free-choice',1);
  // Legal shared node must wait its own sixty-second gate; notice isn't input.
  now='2026-10-10T11:05:00+08:00';resetState('继续原有共同游戏');
  storage.save('school_plan_items','shared-invitation',scenarioItem({id:'shared-invitation',kind:'invitation',title:'刚下发的组内午后茶会邀请',requirement:'optional',issuedAt:now,timing:{kind:'once',startsAt:'2026-10-10T16:00:00+08:00',endsAt:'2026-10-10T16:30:00+08:00'},noticePolicy:{announceOnIssue:true,announceOnChange:true,reminders:[]}}));
  await week('shared-invitation-expand');
  const seed=sharedStorySeed(storage.character(),'wrap',now);storage.set('character',seed.state);storage.set('runtime',{...storage.runtime(),sharedClock:seed.clock});
  assert.equal(await new Scheduler(storage,cfg).collectReady(now),null);await story('shared-next-legal-node',1);
  // A small simulated read is a future intention before the elapsed interval;
  // its actual process/result and mentor feedback can only come from narrative.
  now='2026-10-10T15:00:00+08:00';resetState('接下来读已知科研任务的一页材料，记录一个问题，再请导师看阅读笔记；尚未做，也没有反馈。');
  storage.set('character',{...storage.character(),nextAutonomousAt:new Date(Date.parse(now)+30*60000).toISOString()});await story('research-process',31);
  now=new Date(Date.parse(now)+60*60000).toISOString();storage.set('character',{...storage.character(),plan:'已有阶段笔记，下一步向背景中既有导师请教；要在过去时间里有真实交流才有导师反馈，未知则保留。',nextAutonomousAt:now});await story('mentor-feedback',1);
  now='2026-10-12T06:00:00+08:00';resetState('周一确认本周课表，沿用既有课次。');await week('monday-confirm');
  assert.equal(schoolStore.instances().find(i=>i.sourceItemId==='course'&&i.weekStart==='2026-10-12')!.id,mondayCourse.id);
  assert(schoolStore.progress().some(p=>p.kind==='progress'),'no actual research progress generated');
  for(const p of schoolStore.progress())assert(storage.read('experiences',p.experienceId));
  assert(!personalSchoolContext(storage,[],'').knownSnapshots.some(s=>s.entityId==='draft'));
  }
 }catch(error){failure=error instanceof Error?error.message:String(error);dump('failure');process.exitCode=1;}
 finally{
  await host?.stop();const summary={offline:false,scenario,database:paths.database,modelSettings:Object.fromEntries(modelRoles.map(role=>[role,{model:settings.models[role].model,reasoningEffort:settings.models[role].reasoningEffort}])),requestTimeoutMs:timeoutMs,calls:calls.length,repairs:calls.filter(c=>c.repair).length,failedRequests:calls.filter(c=>c.error).length,totalElapsedMs:calls.reduce((n,c)=>n+(c.elapsedMs??0),0),failure,progress:schoolStore.progress(),sentCount:sent.length,formalDatabaseUnchanged:formalHash()===formalBefore,qqConnected:false,embeddingRequests:0};
  writeFileSync(join(paths.root,'summary.json'),JSON.stringify(summary,null,2));writeFileSync(join(paths.root,'recorded-outgoing.json'),JSON.stringify(sent,null,2));storage.close();
  console.log(JSON.stringify({...summary,modelSettings:undefined,progress:undefined}));
 }
}
main().catch(error=>{console.error(`Isolated acceptance failed: ${error instanceof Error?error.message:String(error)}`);process.exitCode=1;});
