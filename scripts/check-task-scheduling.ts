import {createHash} from 'node:crypto';
import {existsSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {Socket} from 'node:net';

const NOW='2026-10-07T10:00:00+08:00',FUTURE='2026-10-07T03:00:00Z';
const sourceFiles=['src/storage.ts','src/host/scheduler.ts','src/host/shared.ts','src/app.ts','src/environment/runtime.ts','src/environment/snapshot.ts','src/dialogue/window-consistency.ts','src/dialogue/episodes.ts'];
export async function checkTaskScheduling(sourceRoot:string,expectBudgets:boolean){
 const originalFetch=globalThis.fetch,originalConnect=Socket.prototype.connect;
 const rejectNetwork=()=>{throw Error('network calls are forbidden in the task scheduling probe');};
 globalThis.fetch=rejectNetwork;
 Socket.prototype.connect=rejectNetwork;
 try{return await measureTaskScheduling(sourceRoot,expectBudgets);}
 finally{globalThis.fetch=originalFetch;Socket.prototype.connect=originalConnect;}
}
async function measureTaskScheduling(sourceRoot:string,expectBudgets:boolean){
 const [{Storage},{Scheduler},{initialCharacter,defaultConfig}]=await Promise.all([
  import(pathToFileURL(resolve(sourceRoot,'src/storage.ts')).href),
  import(pathToFileURL(resolve(sourceRoot,'src/host/scheduler.ts')).href),
  import(pathToFileURL(resolve(sourceRoot,'src/config.ts')).href),
 ]);
 const archived=resolve(sourceRoot,'source-revision.txt');
 const sourceRevision=existsSync(archived)?readFileSync(archived,'utf8').trim():execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim();
 const sourceHashes=Object.fromEntries(sourceFiles.map(file=>[file,createHash('sha256').update(readFileSync(resolve(sourceRoot,file))).digest('hex')]));
 const cases=[];
 for(const history of [0,1000,10000])for(const pending of [0,3]){
  const samples=[];
  for(let sample=0;sample<7;sample++){
   const storage=new Storage(':memory:');
   try{
    storage.set('character',initialCharacter(NOW));
    storage.set('runtime',{...storage.runtime(),dialogueContextVersion:1,environmentPlanningVersion:1,nextEnvironmentAt:'2026-10-08T06:00:00+08:00'});
    storage.transaction(()=>{
     for(let i=0;i<history;i++)storage.save('tasks','h'+i,{id:'h'+i,kind:'appointment',at:NOW,description:'history',status:i%2?'completed':'cancelled'});
     for(let i=0;i<pending;i++)storage.save('tasks','p'+i,{id:'p'+i,kind:'appointment',at:FUTURE,description:'future',status:'pending'});
    });
    let taskQueries=0,pendingQueries=0,historyQueries=0,materializedRows=0,materializedHistoryRows=0;
    const count=(rows:any[])=>{materializedRows+=rows.length;materializedHistoryRows+=rows.filter(t=>t.status!=='pending').length;return rows;};
    const all=storage.all.bind(storage);
    storage.all=(table:string)=>{const rows=all(table);if(table==='tasks'){taskQueries++;historyQueries++;count(rows);}return rows;};
    if(typeof storage.pendingTasks==='function'){
     const query=storage.pendingTasks.bind(storage);
     storage.pendingTasks=()=>{taskQueries++;pendingQueries++;return count(query());};
    }
    const scheduler=new Scheduler(storage,defaultConfig),start=performance.now();
    const request=await scheduler.collectReady(NOW),deadline=await scheduler.nextDeadline(NOW);
    const elapsedMs=performance.now()-start;
    if(request!==null)throw Error('idle fixture unexpectedly dispatched work');
    const expected=pending?FUTURE:storage.runtime().nextEnvironmentAt;
    if(Date.parse(deadline)!==Date.parse(expected))throw Error('idle deadline changed');
    if(expectBudgets&&(historyQueries!==0||taskQueries>2||materializedHistoryRows!==0||materializedRows>pending*2))throw Error('pending task cost budget exceeded');
    samples.push({elapsedMs,taskQueries,pendingQueries,historyQueries,materializedRows,materializedHistoryRows});
   }finally{storage.close();}
  }
  cases.push({history,pending,samples,medianMs:samples.map(s=>s.elapsedMs).sort((a,b)=>a-b)[3]});
 }
 // This probe only imports Storage, Scheduler and configuration. It never constructs
 // an app/model client or starts a Host, and the idle fixture must not dispatch.
 return {schemaVersion:1,sourceRoot,sourceRevision,sourceIdentity:existsSync(archived)?'archived source-revision.txt':'current HEAD plus sourceHashes',sourceHashes,node:process.version,platform:process.platform,measurement:'one collectReady + nextDeadline per fresh in-memory database; seeding excluded; no model/network calls',expectBudgets,cases};
}
async function main(){
 const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);if(i<0)return null;if(!args[i+1]||args[i+1].startsWith('--'))throw Error(name+' needs a value');return args[i+1];};
 for(let i=0;i<args.length;i++){if(['--output','--source-root'].includes(args[i])){i++;continue;}if(args[i]!=='--expect-budgets')throw Error('unknown option '+args[i]);}
 const sourceRoot=resolve(value('--source-root')??process.cwd()),result=await checkTaskScheduling(sourceRoot,args.includes('--expect-budgets')||!value('--source-root'));
 const output=value('--output');if(output){const target=resolve(output);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,JSON.stringify(result,null,2)+'\n');}
 console.log(JSON.stringify({sourceRevision:result.sourceRevision,cases:result.cases.map(c=>({history:c.history,pending:c.pending,medianMs:c.medianMs,taskQueries:c.samples.map(s=>s.taskQueries),materializedRows:c.samples.map(s=>s.materializedRows)}))},null,2));
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
