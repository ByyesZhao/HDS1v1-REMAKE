import {expect,it} from 'vitest';
import {setup,NOW,narrative} from './helpers';
import {schoolItem,expand} from './world-school-fixture';
import {prepareSchoolCommits} from '../src/school/progress';
import {releaseSchoolNotices} from '../src/school/notices';
import {ModelClient,type CompletionRequest} from '../src/model/client';
import {narrativeTask} from '../src/model/contracts';
import type {SchoolPlanItem} from '../src/school/types';

const experience={id:'experience',happenedAt:NOW,description:'模拟处理研究材料',relatedEventIds:[]};
const turn={id:'turn',at:NOW,schoolNoticeRefs:[]} as any;
const result=(taskId:string)=>({...narrative,experiences:[experience],researchProgress:[{taskId,kind:'progress' as const,experienceIndex:0,summary:'模拟进展'}]});
function know(d:ReturnType<typeof setup>,item:SchoolPlanItem){
 d.storage.save('school_knowledge',item.id,{id:item.id,entityKind:'plan_item',entityId:item.id,revision:item.revision,snapshot:{entityKind:'plan_item',entityId:item.id,revision:item.revision,value:item},acquiredAt:NOW,experienceId:'previous',turnId:'previous',via:'notice'});
}

it('an objective research item without knowledge reports an unknown task',()=>{
 const d=setup(),item=schoolItem({id:'hidden-research',kind:'research'});
 try{
  d.storage.save('school_plan_items',item.id,item);
  expect(()=>prepareSchoolCommits(d.storage,turn,result(item.id),[experience])).toThrow(/researchProgress\.taskId.*hidden-research.*unknown research task/);
  expect(d.schoolStore.progress()).toHaveLength(0);
 }finally{d.storage.close();}
});

it.each(['milestone','meeting'] as const)('known %s reports the actual kind instead of an unknown task',kind=>{
 const d=setup(),item=schoolItem({id:'known-item',kind});
 try{
  know(d,item);
  expect(()=>prepareSchoolCommits(d.storage,turn,result(item.id),[experience])).toThrow(new RegExp('researchProgress\\.taskId.*known-item.*task kind "'+kind+'".*only kind="research"'));
  expect(d.schoolStore.progress()).toHaveLength(0);
 }finally{d.storage.close();}
});

it('an unseen objective change to research cannot authorize a known milestone',()=>{
 const d=setup(),item=schoolItem({id:'changed-item',kind:'milestone'});
 try{
  know(d,item);d.storage.save('school_plan_items',item.id,{...item,kind:'research',revision:2});
  expect(()=>prepareSchoolCommits(d.storage,turn,result(item.id),[experience])).toThrow(/task kind "milestone"/);
 }finally{d.storage.close();}
});

it('a known research revision still accepts progress after an unseen objective type change',()=>{
 const d=setup(),item=schoolItem({id:'known-research',kind:'research'});
 try{
  know(d,item);d.storage.save('school_plan_items',item.id,{...item,kind:'milestone',revision:2});
  expect(prepareSchoolCommits(d.storage,turn,result(item.id),[experience]).progress).toEqual([{taskId:'known-research',kind:'progress',summary:'模拟进展',happenedAt:NOW,experienceId:'experience'}]);
 }finally{d.storage.close();}
});

it('research actually learned in the same experience remains eligible',()=>{
 const d=setup(),item=schoolItem({id:'newly-known-research',kind:'research'});
 try{
  d.storage.save('school_plan_items',item.id,item);expand(d);releaseSchoolNotices(d.storage,NOW,d.config.timezone);
  const notice=d.schoolStore.notices().find(n=>n.kind==='issue')!;
  const draft={...result(item.id),schoolObservations:[{via:'notice' as const,sourceId:notice.id,experienceIndex:0}]};
  const prepared=prepareSchoolCommits(d.storage,{...turn,schoolNoticeRefs:[{noticeId:notice.id,deliveryRevision:notice.deliveryRevision}]},draft,[experience]);
  expect(prepared.progress[0].taskId).toBe('newly-known-research');
 }finally{d.storage.close();}
});

it('automatic repair receives the offending ID and type and returns valid research without partial commits',async()=>{
 const d=setup(),research=schoolItem({id:'valid-research',kind:'research'}),milestone=schoolItem({id:'invalid-milestone',kind:'milestone'}),requests:CompletionRequest[]=[];
 try{
  know(d,research);know(d,milestone);
  const valid=result(research.id),invalid={...valid,researchProgress:[...valid.researchProgress,...result(milestone.id).researchProgress]};
  const client=new ModelClient({complete:async request=>{requests.push(request);return requests.length===1?invalid:valid;}});
  const task=narrativeTask(false,NOW,NOW,[],null,null,r=>{prepareSchoolCommits(d.storage,turn,r,[experience]);});
  const repaired=await client.runModel(task,{});
  expect(repaired.researchProgress).toEqual(valid.researchProgress);
  expect(requests).toHaveLength(2);
  expect(requests[1].repair?.errors).toMatch(/researchProgress\.taskId.*invalid-milestone.*task kind "milestone".*only kind="research"/);
  expect(d.schoolStore.progress()).toHaveLength(0);
 }finally{d.storage.close();}
});
