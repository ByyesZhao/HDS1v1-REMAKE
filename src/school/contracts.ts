import {z} from 'zod';
import type {Dependencies} from '../app';
import type {ModelTask} from '../types';
import type {EnvironmentModelResult} from '../environment/types';
import {prompts} from '../model/prompts';
import {validateWeekCoverage} from './calendar';
import type {SchoolExpansionInput} from './types';
const time=z.iso.datetime({offset:true}),date=z.iso.date(),clock=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const timingSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('once'),startsAt:time,endsAt:time.nullable()}),
 z.object({kind:z.literal('weekly'),startsOn:date,endsOn:date.nullable(),slots:z.array(z.object({slotKey:z.string().min(1),weekday:z.number().int().min(1).max(7),start:clock,end:clock})).min(1)}),
 z.object({kind:z.literal('tentative'),startsOn:date,endsOn:date.nullable(),note:z.string()}),
 z.object({kind:z.literal('deadline'),at:time.nullable(),date:date.nullable(),note:z.string()}),
]);
const policy=z.object({announceOnIssue:z.boolean().default(true),announceOnChange:z.boolean().default(true),reminders:z.array(z.object({kind:z.enum(['local_days_before','minutes_before']),offset:z.number().int().nonnegative(),source:z.enum(['institution','personal_reminder'])}))});
const plan=z.object({owner:z.enum(['campus','group']),kind:z.enum(['semester','group']),title:z.string().min(1),startsOn:date,endsOn:date.nullable(),summary:z.string(),status:z.enum(['active','archived'])}).strict();
const item=z.object({planId:z.string().min(1),owner:z.enum(['campus','group']),kind:z.enum(['course','exam','meeting','event','research','invitation','holiday','milestone','legacy']),title:z.string().min(1),description:z.string(),location:z.string(),requirement:z.enum(['required','optional']),issuedAt:time,timing:timingSchema,noticePolicy:policy.optional(),status:z.enum(['open','cancelled','closed']),basis:z.enum(['fiction','web_reference']).default('fiction'),sourceUrls:z.array(z.url()).default([]),responsible:z.string().optional(),deliverable:z.string().optional(),stageInfo:z.string().optional()}).strict();
const planChange=z.discriminatedUnion('action',[z.object({action:z.literal('create'),clientRef:z.string().min(1),plan}),z.object({action:z.literal('update'),id:z.string(),expectedRevision:z.number().int().positive(),plan:plan.partial()})]);
const itemChange=z.discriminatedUnion('action',[z.object({action:z.literal('create'),clientRef:z.string().min(1),item}),z.object({action:z.literal('update'),id:z.string(),expectedRevision:z.number().int().positive(),item:item.partial()}),z.object({action:z.literal('cancel'),id:z.string(),expectedRevision:z.number().int().positive()})]);
function defaultPolicy(timing:import('./types').SchoolTiming){return {announceOnIssue:true,announceOnChange:true,reminders:timing.kind==='tentative'||timing.kind==='deadline'&&!timing.at?[]:timing.kind==='weekly'?[{kind:'minutes_before' as const,offset:60,source:'institution' as const}]:[{kind:'local_days_before' as const,offset:1,source:'institution' as const},{kind:'minutes_before' as const,offset:120,source:'institution' as const}]};}
function upstreamTask(d:Dependencies,owner:'campus'|'group',providedUrls:()=>string[]):ModelTask<EnvironmentModelResult>{
 const stage=owner==='campus'?'school_campus':'school_group';
 const schema=z.object({stage:z.literal(stage),planChanges:z.array(planChange),itemChanges:z.array(itemChange)}).strict();
 return {name:stage,prompt:prompts[stage],schema:z.toJSONSchema(schema),parse(raw){
  const value=schema.parse(raw),refs=new Set<string>(),changed=new Set<string>();
  for(const c of [...value.planChanges,...value.itemChanges]){
   if(c.action==='create'){if(refs.has(c.clientRef))throw Error('duplicate clientRef');refs.add(c.clientRef);}else{if(changed.has(c.id))throw Error('duplicate change ID');changed.add(c.id);}
  }
  const check=(record:{owner:string;revision:number}|null,revision:number)=>{if(!record||record.owner!==owner)throw Error('school owner mismatch');if(record.revision!==revision)throw Error('school revision mismatch');};
  for(const c of value.planChanges){if(c.action==='create'){if(c.plan.owner!==owner)throw Error('school owner mismatch');}else{check(d.storage.read('school_plans',c.id),c.expectedRevision);if(c.plan.owner&&c.plan.owner!==owner)throw Error('school owner mismatch');}}
  for(const c of value.itemChanges){
   if(c.action!=='create')check(d.storage.read('school_plan_items',c.id),c.expectedRevision);
   if(c.action==='cancel')continue;
   if(c.action==='create'&&c.item.owner!==owner||c.item.owner&&c.item.owner!==owner)throw Error('school owner mismatch');
   if(c.item.planId){const target=d.storage.read('school_plans',c.item.planId),draft=value.planChanges.find(p=>p.action==='create'&&p.clientRef===c.item.planId);if(!target&&!draft||target&&target.owner!==owner)throw Error('unknown or wrong owner planId');}
   if(c.action==='create'&&!c.item.noticePolicy)c.item.noticePolicy=defaultPolicy(c.item.timing);
   const merged=c.action==='create'?c.item:{...d.storage.read('school_plan_items',c.id)!,...c.item};
   const basis=merged.basis,urls=merged.sourceUrls;if(basis==='fiction'&&urls?.length)throw Error('fiction sourceUrls must be empty');if(basis==='web_reference'&&(c.action==='create'||c.item.basis!==undefined||c.item.sourceUrls!==undefined)&&(!urls?.length||urls.some(url=>!providedUrls().includes(url))))throw Error('URL was not supplied');
   const t=merged.timing;if(t?.kind==='once'&&t.endsAt&&Date.parse(t.endsAt)<Date.parse(t.startsAt))throw Error('school end precedes start');
   if(t?.kind==='weekly'&&new Set(t.slots.map(s=>s.slotKey)).size!==t.slots.length)throw Error('duplicate slotKey');
  }
  if(!d.schoolStore.plans().some(p=>p.owner===owner&&p.status==='active')&&!value.planChanges.some(c=>c.action==='create'&&c.plan.status==='active'))throw Error('initial school planning requires an active plan; zero courses is allowed');
  return value as EnvironmentModelResult;
 }};
}
export const schoolCampusTask=(d:Dependencies,urls:()=>string[]=()=>[])=>upstreamTask(d,'campus',urls);
export const schoolGroupTask=(d:Dependencies,urls:()=>string[]=()=>[])=>upstreamTask(d,'group',urls);
export const schoolWeekSchema=z.object({stage:z.literal('school_week'),instanceChanges:z.array(z.object({occurrenceKey:z.string(),sourceItemId:z.string(),expectedRevision:z.number().int().positive()})),noticeCandidates:z.array(z.object({key:z.string(),text:z.string().min(1),entityRefs:z.array(z.object({entityKind:z.enum(['plan_item','instance']),entityId:z.string()}))})),weekChanges:z.array(z.object({weekStart:date,sourceVersions:z.record(z.string(),z.number().int().positive()),conflictNotes:z.array(z.string())}))}).strict();
export function schoolWeekTask(input?:SchoolExpansionInput):ModelTask<EnvironmentModelResult>{return {name:'school_week',prompt:prompts.school_week+'\ninstanceChanges.expectedRevision必须取context.sourceItems中sourceItemId对应条目的当前revision；requiredOccurrences不携带版本，existingInstances.sourceRevision及其旧快照只用于对照，改期时不能复制旧版本。修补时逐项改为报错指出的当前版本。requiredOccurrences中status=cancelled也是必需候选，表示删除时段或缩短范围后退役旧未来课次，仍按给定key引用最新上游版本；状态由程序保存。带after的key是已发生历史之后的新安排，逐字复制，不能重新引用历史key覆盖旧课次。',schema:z.toJSONSchema(schoolWeekSchema),parse:raw=>{const result=schoolWeekSchema.parse(raw);if(input)validateWeekCoverage(result,input);return result;}};}
