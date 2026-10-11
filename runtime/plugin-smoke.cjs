const {Context}=require('koishi');
const {mkdtempSync,readFileSync,writeFileSync,rmSync}=require('node:fs');
const {resolve,join,sep}=require('node:path');
const {tmpdir}=require('node:os');
const {performance}=require('node:perf_hooks');
const {DatabaseSync}=require('node:sqlite');
const testLib=process.env.HDSI_TEST_LIB_DIR||resolve(__dirname,'../lib');
const plugin=require(join(testLib,'index.js'));
const {systemClock}=require(join(testLib,'time.js'));
const {parseEnvelopeRequest,mockEnvironmentResponse,waitForEnvironmentBatch,validatePersistedNotices}=require('./plugin-smoke-fixtures.cjs');
async function runScenario(scenario){
 const workspace=mkdtempSync(join(tmpdir(),'hdsi-plugin-smoke-')),settingsPath=join(workspace,'story.json');
 const sample=JSON.parse(readFileSync(resolve(__dirname,'../examples/story.sample.json'),'utf8'));
 sample.initialDetails=[{key:'phone',value:'offline phone fixture',aliases:['手机']}];
 sample.initialSleep={sleepAt:'2026-10-08T23:00:00Z',wakeAt:'2026-10-09T05:00:00Z'};
 writeFileSync(settingsPath,JSON.stringify(sample));
 const oldKey=process.env.DEEPSEEK_API_KEY,oldEmbeddingKey=process.env.QWEN_API_KEY,oldFetch=global.fetch,oldNow=systemClock.now;
 let embeddingRequests=0,repairs=0,inspect;const calls={},requests=[];
 systemClock.now=()=> '2026-10-09T02:00:00.000Z';
 process.env.DEEPSEEK_API_KEY='offline-smoke-key';process.env.QWEN_API_KEY='offline-smoke-embedding';
 global.fetch=async(url,init)=>{
  if(String(url).endsWith('/embeddings')){embeddingRequests++;return new Response(JSON.stringify({data:[{embedding:Array.from({length:1024},(_,i)=>i===0?1:0)}]}));}
  if(!String(url).endsWith('/chat/completions'))throw Error('unexpected offline URL');
  const {envelope,context,stage}=parseEnvelopeRequest(init);requests.push(context);calls[stage]=(calls[stage]??0)+1;if(envelope.repair)repairs++;
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(mockEnvironmentResponse(context,scenario))}}]}));
 };
 const ctx=new Context();ctx.baseDir=workspace;
 const rows=table=>inspect.prepare('SELECT data FROM '+table+' ORDER BY rowid').all().map(row=>JSON.parse(row.data));
 try{
  ctx.plugin(plugin,{botId:'1000000000',userId:'1000000001',databasePath:'offline.sqlite',storyConfigPath:settingsPath});
  await ctx.start();inspect=new DatabaseSync(join(workspace,'offline.sqlite'),{readOnly:true});
  const snapshot=await waitForEnvironmentBatch(id=>({batch:rows('environment_batches').find(b=>id?b.id===id:true),steps:rows('environment_steps').filter(s=>!id||s.batchId===id),paused:JSON.parse(inspect.prepare("SELECT data FROM state WHERE key='runtime'").get().data).paused,calls}),null,performance.now()+10000);
  if(snapshot.steps.some(s=>s.attempt!==1||s.lastError!==null)||repairs)throw Error('unexpected repair/retry');
  const expected=scenario==='empty_week'?3:4;
  if(Object.values(calls).reduce((a,b)=>a+b,0)!==expected||calls.world!==1||calls.school_campus!==1||calls.school_group!==1||(calls.school_week??0)!==(expected-3))throw Error('unexpected generation distribution '+JSON.stringify(calls));
  const week=snapshot.steps.find(s=>s.stage==='school_week');
  if(snapshot.steps.some(s=>s.terminalAudit?.version!==1||s.terminalAudit.input.modelContractVersion!==1||s.inputSnapshot!==null||s.preparationSnapshot!==null||s.frozenResult!==null))throw Error('missing V1 terminal audit or retained terminal payload');
  const summary=week.terminalAudit;
  if(scenario==='empty_week'&&(JSON.stringify(summary.input.requiredNoticeIds)!=='[]'||summary.result.counts.notices!==0))throw Error('empty week generated notices');
  if(JSON.stringify([...summary.result.entityIds.notices].sort())!==JSON.stringify(rows('school_notices').map(n=>n.id).sort()))throw Error('notice audit identity mismatch');
  if(scenario==='required_notice'){
   const frozenKeys=summary.input.requiredNoticeIds,textKeys=requests.find(r=>r.stage==='school_week').notices.map(n=>n.key);
   if(!frozenKeys.length||JSON.stringify(frozenKeys)!==JSON.stringify(textKeys)||!rows('school_instances').length)throw Error('notice freeze identity mismatch');
   validatePersistedNotices(frozenKeys,rows('school_notices'));
  }
  const indexDeadline=performance.now()+10000;
  while(!inspect.prepare("SELECT 1 FROM memory_index_jobs WHERE json_extract(data,'$.status')='done' AND json_extract(data,'$.completionReason')='applied'").get()&&performance.now()<indexDeadline)await new Promise(resolve=>setImmediate(resolve));
  if(embeddingRequests!==1||inspect.prepare('SELECT count(*) n FROM memory_index').get().n!==1)throw Error('detail vector not applied');
  const detail=rows('details').find(r=>r.key==='phone'),runtime=JSON.parse(inspect.prepare("SELECT data FROM state WHERE key='runtime'").get().data);
  if(detail?.ownerType!=='detail'||detail.revision!==1||runtime.sharedActivityVersion!==1||runtime.sharedClock!==null||rows('control_requests').length||rows('school_plans').length!==2||!ctx.$commander.get('hdsi.status'))throw Error('plugin initial state mismatch');
  console.log(scenario+': four committed steps; calls='+JSON.stringify(calls)+'; embedding=1; repair=0');
 }finally{
  inspect?.close();await ctx.stop();await new Promise(resolve=>setImmediate(resolve));
  global.fetch=oldFetch;systemClock.now=oldNow;
  if(oldKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=oldKey;
  if(oldEmbeddingKey===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=oldEmbeddingKey;
  if(!resolve(workspace).startsWith(resolve(tmpdir())+sep))throw Error('unsafe smoke workspace path');
  rmSync(workspace,{recursive:true,force:true});
 }
}
async function main(){await runScenario('empty_week');await runScenario('required_notice');}
module.exports={runScenario};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
