const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Storage}=require('../../../../lib/storage');
const {HdsiApp}=require('../../../../lib/app');
const {InputBuffer}=require('../../../../lib/host/input');
const {DialogueEpisodes}=require('../../../../lib/dialogue/episodes');
const {ChatEpisodes}=require('../../../../lib/dialogue/chat-episodes');
const {DialogueStore}=require('../../../../lib/dialogue/store');
const {EnvironmentStore}=require('../../../../lib/environment/store');
const {SchoolStore}=require('../../../../lib/school/store');
const {defaultConfig,initialCharacter}=require('../../../../lib/config');
const at='2026-10-07T10:00:00+08:00';
(async()=>{
 const s=new Storage(':memory:');let fail=true;const calls=[],recentCalls={v1:0,v2:0};
 const oldV1=DialogueEpisodes.prototype.recent,oldV2=ChatEpisodes.prototype.recent;
 DialogueEpisodes.prototype.recent=function(...args){recentCalls.v1++;return oldV1.apply(this,args);};
 ChatEpisodes.prototype.recent=function(...args){recentCalls.v2++;return oldV2.apply(this,args);};
 try{
  s.set('character',initialCharacter(at));s.set('runtime',{...s.runtime(),dialogueContextVersion:1,nextEnvironmentAt:'2099-01-01T00:00:00Z'});
  const d={storage:s,clock:{now:()=>at},random:{next:()=>0.5},config:{...defaultConfig,background:'离线合成',chatExamples:'嗯'},environmentStore:new EnvironmentStore(s),schoolStore:new SchoolStore(s),wait:async()=>{},sender:{sendError:async()=>{},sendItem:async()=>({platformMessageIds:['synthetic']})},models:{runModel:async(task,input)=>{calls.push(task.name);if(task.name==='narrative'&&fail)throw Error('synthetic generation interruption');const outputs={narrative:{experiences:[],currentScene:{description:'宿舍',activity:null},energy:{level:'正常',reason:'休息'}},personal_chat:{emotions:[],reply:{decision:'none'},taskChanges:[]},memory:{schemaVersion:3,shortTermChanges:[],longTermChanges:[],detailChanges:[]}};return task.parse(outputs[task.name]);}}};
  await new InputBuffer(s).acceptInput({id:'input',content:'你好',receivedAt:at});
  const app=new HdsiApp(d);await assert.rejects(()=>app.runTurn({inputMessageIds:['input'],taskIds:[],triggerKinds:['input']}),/synthetic generation interruption/);
  const old=s.unfinishedTurn(),binding=structuredClone(old.dialogueBinding);assert.equal(old.dialogueWindowVersion,1);assert.equal(recentCalls.v1,1);
  s.set('runtime',{...s.runtime(),dialogueContextVersion:2});
  new ChatEpisodes(new DialogueStore(s)).acceptMessage(s.read('messages','input'));
  const beforeRecovery=structuredClone(recentCalls);fail=false;await app.resumeUnfinishedTurn();
  assert.equal(s.runtime().dialogueContextVersion,2);assert.equal(s.read('turns',old.id).done,true);assert.equal(s.read('turns',old.id).dialogueWindowVersion,1);
  assert.equal(s.read('turns',old.id).dialogueBinding.episodeId,binding.episodeId);assert.equal(recentCalls.v2,0);assert.equal(recentCalls.v1-beforeRecovery.v1,2);
  const result={status:'passed',scope:'offline synthetic in-memory interrupted v1 turn, then runtime upgraded to v2 with valid chat associations',recentCalls,recoveryRecentV1:recentCalls.v1-beforeRecovery.v1,modelCalls:calls,dialogueBindingPreserved:true,turnDone:true};
  fs.writeFileSync(path.join(__dirname,'v1-recovery-probe.json'),JSON.stringify(result,null,2));process.stdout.write(JSON.stringify(result)+'\n');
 }finally{DialogueEpisodes.prototype.recent=oldV1;ChatEpisodes.prototype.recent=oldV2;s.close();}
})().catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1;});
