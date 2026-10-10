import { buildPromptPolicy,policyRules } from './prompt-policy';
import { z } from 'zod';
import type { ModelTask, NarrativeResult, SharedNarrativeResult, SharedTurnMeta, SharedOutline, PersonalResult, ExpressionResult, MemoryResult, EnvironmentResult, ScheduledTask, EnvironmentEvent } from '../types';
import { prompts, sharedNarrativePrompt } from './prompts';
import { milliseconds } from '../time';
import type { MemoryCandidate, MaintenanceUnit, OwnerVersion } from '../memory/types';
import {summaryRepairPair} from '../memory/summary-repair';
import {promotionEligible} from '../memory/capacity';

const text = z.string();
const time = z.iso.datetime({ offset: true });
const emotion = z.object({ label: text, degree: text, reason: text });
const energy = z.object({ level: z.enum(['精力充沛', '正常', '疲惫', '精疲力尽']), reason: text });
const activity = z.object({ description: text, startsAt: time, expectedEndAt: time.nullable(), phoneAccess: z.boolean() });
const narrative = z.object({
  experiences: z.array(z.object({ happenedAt: time, description: text, relatedEventIds: z.array(text) })),
  currentScene: z.object({ description: text, activity: activity.nullable() }), energy,
  schoolObservations:z.array(z.object({via:z.enum(['notice','onsite']),sourceId:text,experienceIndex:z.number().int().nonnegative()})).default([]),
  researchProgress:z.array(z.object({taskId:text,kind:z.enum(['progress','completed','feedback']),experienceIndex:z.number().int().nonnegative(),summary:text})).default([]),
});
const sharedNarrative = narrative.extend({ publicNarration: text.nullable(), progress: text,
  outline: z.object({ goal: text.min(1), openThreads: z.array(text.min(1)), endingCondition: text.min(1) }),
  simulatedUserActions: z.array(text.trim().min(1)) }).strict();
const intent = { intention: text, draft: text, actions: z.array(text).optional() };
const reply = z.discriminatedUnion('decision', [z.object({ decision: z.literal('now'), ...intent }), z.object({ decision: z.literal('later'), reconsiderAt: time, intention: text }), z.object({ decision: z.literal('none') })]);
const contact = z.discriminatedUnion('willing', [z.object({ willing: z.literal(true), ...intent }), z.object({ willing: z.literal(false) })]);
const taskDetails = z.object({ kind: z.enum(['appointment', 'check_messages', 'scene_step']), at: time, description: text, checkReason: z.enum(['unread', 'deferred_reply']).optional(), messageIds: z.array(text).optional() });
const taskChange = z.discriminatedUnion('action', [z.object({ action: z.literal('create'), task: taskDetails }), z.object({ action: z.literal('update'), id: text, task: taskDetails.partial() }), z.object({ action: z.literal('cancel'), id: text })]);
const options = {
  nextPlan: text.nullable().optional(), stickerIntent: text.optional(),
  sleepPreference: z.object({ reason: text, sleepAt: time.nullable(), wakeAt: time.nullable() }).optional(),
  sharedChange: z.discriminatedUnion('action', [z.object({ action: z.literal('start'), mode: z.enum(['shared_online', 'shared_offline']), title: text }), z.object({ action: z.literal('end') })]).optional(),
};
const chat = z.object({ emotions: z.array(emotion), reply, taskChanges: z.array(taskChange), ...options });
const life = z.object({ innerThought: text, emotions: z.array(emotion), contact, taskChanges: z.array(taskChange).optional(), ...options });
const hasActionMarker = (value: string) => /【动作[：:][^】]*】/u.test(value);
const summary = {content:text,eventSummary:text,feelingSummary:text,topics:z.array(text),sourceIds:z.array(text).min(1)};
const eventTimes={happenedAt:time.optional(),happenedUntil:time.optional()};
const memory = z.object({
  schemaVersion:z.literal(3),
  shortTermChanges:z.array(z.discriminatedUnion('action',[z.object({action:z.literal('create'),clientRef:text,...summary,importance:z.enum(['normal','high']),existingLongId:text.optional(),hasNewEventProgress:z.boolean().optional(),...eventTimes}),z.object({action:z.literal('update'),id:text,...summary,hasNewEventProgress:z.boolean(),...eventTimes})])),
  longTermChanges: z.array(z.object({action:z.literal('awaken'),id:text,reason:text,sourceIds:z.array(text).min(1)})),
  detailChanges: z.array(z.object({ action: z.enum(['create', 'update']), key: text, value: text, aliases: z.array(text), reason: text, sourceIds: z.array(text).min(1) })),
});
const event = z.object({ kind: z.enum(['world', 'school']), startsAt: time, endsAt: time.nullable(), description: text, basis: z.enum(['fiction', 'web_reference']), sourceUrls: z.array(z.url()) });
const environment = z.object({ changes: z.array(z.discriminatedUnion('action', [z.object({ action: z.literal('create'), event }), z.object({ action: z.literal('update'), id: text, event: event.partial() }), z.object({ action: z.literal('cancel'), id: text })])) });

export function modelTask<T>(name: keyof typeof prompts, schema: z.ZodType, validate?: (result: T) => void): ModelTask<T> {
  return { name, schema: z.toJSONSchema(schema), prompt: prompts[name], parse(value) { const result = schema.parse(value) as T; validate?.(result); return result; } };
}
const requireControl = (condition: boolean, path: string, message: string) => { if (!condition) throw new Error(`${path}: ${message}`); };

export function narrativeTask(shared: boolean, from: string, at: string, eventIds: string[] = [], sharedMeta?: SharedTurnMeta | null, previousOutline?: SharedOutline | null,validateSchool?:(r:NarrativeResult)=>void, mode = shared ? 'shared_online' : 'chat'): ModelTask<NarrativeResult | SharedNarrativeResult> {
  sharedMeta=sharedMeta?structuredClone(sharedMeta):sharedMeta;
  const task = modelTask(shared ? 'narrative_shared' : 'narrative', shared ? sharedNarrative : narrative, (r: NarrativeResult | SharedNarrativeResult) => {
    r.experiences.forEach((e, i) => {
      requireControl(milliseconds(e.happenedAt) >= milliseconds(from) && milliseconds(e.happenedAt) <= milliseconds(at), `experiences.${i}.happenedAt`, 'must be within the elapsed interval');
      requireControl(e.relatedEventIds.every(id => eventIds.includes(id)), `experiences.${i}.relatedEventIds`, 'unknown event ID');
    });
    const a = r.currentScene.activity;
    if (a) {
      requireControl(milliseconds(a.startsAt) <= milliseconds(at), 'currentScene.activity.startsAt', 'current activity cannot start in the future');
      requireControl(a.expectedEndAt === null || milliseconds(a.expectedEndAt) >= milliseconds(a.startsAt), 'currentScene.activity.expectedEndAt', 'must follow startsAt');
      if (!a.phoneAccess) {
        requireControl(a.expectedEndAt !== null, 'currentScene.activity.expectedEndAt', 'required when phoneAccess=false');
        requireControl(milliseconds(a.expectedEndAt!) > milliseconds(a.startsAt), 'currentScene.activity.expectedEndAt', 'must be later than startsAt when phoneAccess=false');
      }
    }
    validateSchool?.(r);
    if (shared) {
      requireControl(!!sharedMeta, 'sharedMeta', 'shared calls require fixed selection metadata');
      const result = r as SharedNarrativeResult;
      if (mode !== 'shared_offline' && result.publicNarration) requireControl(!hasActionMarker(`【${result.publicNarration}】`), 'publicNarration', 'public action markers require shared_offline output');
      if (sharedMeta!.stepNumber === 1) requireControl(!!result.publicNarration?.trim(), 'publicNarration', 'first shared node requires a public opening');
      requireControl(sharedMeta!.allowSimulatedUserActions || result.simulatedUserActions.length === 0, 'simulatedUserActions', 'not allowed with new user input');
      requireControl(result.simulatedUserActions.every(action => !!result.publicNarration?.includes(action)), 'publicNarration', 'every simulatedUserActions entry must appear verbatim');
      if (sharedMeta!.phase === 'wrap_up' && previousOutline) {
        const normalize = (thread: string) => thread.trim().replace(/\s+/g, ' ');
        result.outline.openThreads = result.outline.openThreads.map(thread => {
          const original = previousOutline.openThreads.find(old => normalize(old) === normalize(thread));
          requireControl(original !== undefined, 'outline.openThreads', 'wrap_up may only retain or remove original strings (whitespace differences allowed)');
          return original!;
        });
      }
      if (sharedMeta!.phase === 'final') {
        requireControl(result.outline.openThreads.length === 0, 'outline.openThreads', 'final must leave no open threads');
        requireControl(!!result.publicNarration?.trim(), 'publicNarration', 'final requires a public closing node');
      }
    }
  });
  // Use the selected turn's frozen permission, including repair and regeneration.
  task.promptPolicy=buildPromptPolicy(shared?'narrative_shared':'narrative',{sharedMeta,mode});
  if(shared)task.prompt=sharedNarrativePrompt(sharedMeta?.allowSimulatedUserActions===true)+'\n'+policyRules(task.promptPolicy);
  return task;
}

export function personalTask(kind: 'chat' | 'life' | 'shared', at: string, tasks: ScheduledTask[], mode: string, messageIds: string[], sharedMeta?: SharedTurnMeta | null, publicNarration?: string | null, eligibility:{contactEligible?:boolean;hasVisualInput?:boolean}={}): ModelTask<PersonalResult> {
  sharedMeta=sharedMeta?structuredClone(sharedMeta):sharedMeta;
  const schema=kind==='life'?(eligibility.contactEligible===false?life.extend({contact:z.object({willing:z.literal(false)})}):life):chat;
  const task=modelTask(`personal_${kind}`,schema, (r: PersonalResult) => {
    if (kind === 'shared') {
      requireControl(!!sharedMeta, 'sharedMeta', 'shared calls require fixed selection metadata');
      if (sharedMeta!.phase === 'final') requireControl(r.sharedChange?.action === 'end', 'sharedChange', 'final must end the shared activity');
      if (r.sharedChange?.action === 'end') requireControl(!!publicNarration?.trim(), 'publicNarration', 'end requires existing public closing narration; you cannot rewrite narrative: defer end and plan a public close if narration is empty');
    }
    if ('reply' in r && r.reply.decision === 'later') requireControl(milliseconds(r.reply.reconsiderAt) > milliseconds(at), 'reply.reconsiderAt', 'must be later than at');
    const touched = new Set<string>();
    for (const [i, change] of (r.taskChanges ?? []).entries()) {
      let final;
      if (change.action !== 'create') {
        const old = tasks.find(t => t.id === change.id);
        requireControl(!!old, `taskChanges.${i}.id`, 'unknown task ID');
        requireControl(old?.kind !== 'scene_step', `taskChanges.${i}`, 'scene_step is program-owned');
        requireControl(!touched.has(change.id), `taskChanges.${i}.id`, 'duplicate change');
        touched.add(change.id);
        if (change.action === 'update') final = { ...old!, ...change.task };
      } else final = change.task;
      requireControl(final?.kind !== 'scene_step', `taskChanges.${i}`, 'scene_step is program-owned');
      if (final?.kind === 'check_messages') {
        requireControl(milliseconds(final.at) > milliseconds(at), `taskChanges.${i}.task.at`, 'must be later than at');
        requireControl(!!final.checkReason && Array.isArray(final.messageIds), `taskChanges.${i}.task`, 'check_messages requires checkReason and messageIds');
        requireControl(final.messageIds!.every(id => messageIds.includes(id)), `taskChanges.${i}.task.messageIds`, 'unknown visible message ID');
      }
    }
    const s = r.sleepPreference;
    if (s?.sleepAt && s.wakeAt) requireControl(milliseconds(s.wakeAt) > Math.max(milliseconds(s.sleepAt), milliseconds(at)), 'sleepPreference.wakeAt', 'must follow sleepAt');
    if (r.sharedChange?.action === 'start') requireControl(mode === 'chat', 'sharedChange', 'end the current shared activity before starting another');
    if (r.sharedChange?.action === 'end') requireControl(mode !== 'chat', 'sharedChange', 'there is no shared activity to end');
    // Entry into an offline activity grants its opening reply the same contract
    // as the activity; its closing reply is still offline before the end marker.
    const outputMode = r.sharedChange?.action === 'start' ? r.sharedChange.mode : mode;
    const outputIntent = 'reply' in r ? r.reply.decision === 'now' ? r.reply : null : r.contact.willing ? r.contact : null;
    if (outputMode !== 'shared_offline' && outputIntent) {
      requireControl(!outputIntent.actions?.length, 'actions', 'action intentions require shared_offline output');
      requireControl(!hasActionMarker(outputIntent.draft), 'draft', 'action markers require shared_offline output');
    }
  });
  task.promptPolicy=buildPromptPolicy(`personal_${kind}`,{mode,sharedMeta,hasCurrentPublicNarration:!!publicNarration?.trim(),...eligibility});task.prompt+='\n'+policyRules(task.promptPolicy);return task;
}
export function expressionTask(mode = 'chat'): ModelTask<ExpressionResult> {
  const offline = mode === 'shared_offline';
  const schema = z.object({ parts: z.array(z.object({ kind: offline ? z.enum(['text', 'action']) : z.literal('text'), content: text })) });
  return modelTask<ExpressionResult>('expression', schema, result => {
    if (!offline) result.parts.forEach((part, i) => requireControl(!hasActionMarker(part.content), `parts.${i}.content`, 'action markers require shared_offline output'));
  });
}
export function memoryTask(sourceIds: string[], memoryIds: string[], shortIds:string[]=[],selfReadIds:string[]=[]): ModelTask<MemoryResult> {
  return modelTask('memory', memory, (r: MemoryResult) => {
    const validateSources = (ids: string[], allowed=sourceIds) => requireControl(ids.length>0&&ids.every(id => allowed.includes(id)), 'sourceIds', 'unknown current source ID');
    const touched=new Set<string>();const refs=new Set<string>();
    r.shortTermChanges.forEach(c=>requireControl(!!c.eventSummary.trim()||!!c.feelingSummary.trim(),'summary','eventSummary or feelingSummary must be meaningful'));
    r.shortTermChanges.forEach(c=>{validateSources(c.sourceIds,[...sourceIds,...selfReadIds]);if(c.action==='update'){requireControl(shortIds.includes(c.id)&&!touched.has(c.id),'shortTermChanges.id','unknown or duplicate memory ID');touched.add(c.id);}else{requireControl(!refs.has(c.clientRef),'shortTermChanges.clientRef','duplicate clientRef');refs.add(c.clientRef);if(c.existingLongId){requireControl(memoryIds.includes(c.existingLongId),'existingLongId','unknown memory ID');requireControl(typeof c.hasNewEventProgress==='boolean','shortTermChanges.hasNewEventProgress','required for existingLongId');}}});
    r.detailChanges.forEach(d=>validateSources(d.sourceIds));
    const awakened=new Set<string>();r.longTermChanges.forEach(c=>{validateSources(c.sourceIds);requireControl(memoryIds.includes(c.id)&&!awakened.has(c.id),'longTermChanges.id','unknown or duplicate memory ID');awakened.add(c.id);});
  });
}
export function environmentTask(kind: 'world' | 'school', old: EnvironmentEvent[], urls: string[]|(()=>readonly string[])): ModelTask<EnvironmentResult> {
  return modelTask(kind, environment, (r: EnvironmentResult) => {
    for (const [i, c] of r.changes.entries()) {
      const prior = c.action !== 'create' ? old.find(e => e.id === c.id && e.kind === kind) : undefined;
      if (c.action !== 'create') requireControl(!!prior, `changes.${i}.id`, 'unknown event ID');
      if (c.action === 'cancel') continue;
      const e = c.action === 'create' ? c.event : { ...prior!, ...c.event };
      requireControl(e.kind === kind, `changes.${i}.event.kind`, 'wrong director kind');
      requireControl(!e.endsAt || milliseconds(e.endsAt) >= milliseconds(e.startsAt), `changes.${i}.event.endsAt`, 'must follow startsAt');
      requireControl(e.sourceUrls.every(url => (typeof urls==='function'?urls():urls).includes(url)), `changes.${i}.event.sourceUrls`, 'URL was not supplied');
      requireControl(e.basis !== 'web_reference' || e.sourceUrls.length > 0, `changes.${i}.event.basis`, 'web_reference requires actual provided sources');
    }
  });
}

export function consolidationTask(snapshot:MemoryCandidate[],selectedIds:string[],kind:'consolidation'|'audit'='consolidation',evaluationAt?:string):ModelTask<MaintenanceUnit[]> {
  const unit=z.object({unitKey:text.min(1),action:z.enum(['refine','merge','merge_short','discard','promote','retain','review_detail','review_learned']),readOwners:z.array(text).min(1),ids:z.array(text).min(1),sourceIds:z.array(text),canonicalId:text.optional(),canonicalShortId:text.optional(),targetId:text.optional(),decision:z.enum(['retain','report_conflict','suggest_revision','suggest_withdrawal']).optional(),content:text.optional(),eventSummary:text.optional(),feelingSummary:text.optional(),learnedKind:z.enum(['durable_experience','stable_understanding']).optional(),alwaysInclude:z.boolean().optional(),reason:text.optional()});
  const schema=z.object({units:z.array(unit)});
  return {name:'memory_consolidation',prompt:kind==='audit'?prompts.memory_audit:prompts.memory_consolidation,schema:z.toJSONSchema(schema),parse(value:unknown){
    const parsed=schema.parse(value),touched=new Set<string>(),unitKeys=new Set<string>(),covered=new Set<string>();
    const available=new Map(snapshot.map(row=>[row.id,row])),sources=new Set(snapshot.flatMap(row=>row.sourceIds));
    const repairLongs=snapshot.filter(r=>selectedIds.includes(r.id)||!!r.linkedLongId&&selectedIds.includes(r.linkedLongId)).filter(r=>summaryRepairPair(r,r.linkedLongId?available.get(r.linkedLongId)??null:null)).map(r=>r.linkedLongId!);
    const units=parsed.units.map(u=>{
      requireControl(!unitKeys.has(u.unitKey),'unitKey','duplicate unit');unitKeys.add(u.unitKey);
      requireControl(u.readOwners.every(id=>available.has(id)),'readOwners','unknown snapshot owner');
      requireControl(u.ids.every(id=>u.readOwners.includes(id)),'ids','writes outside readOwners');
      requireControl(new Set(u.ids).size===u.ids.length,'ids','duplicate identities');
      if(kind==='consolidation'&&u.ids.some(id=>repairLongs.includes(id)||repairLongs.includes(available.get(id)?.linkedLongId??'')))requireControl(['refine','merge','merge_short'].includes(u.action)&&repairLongs.filter(id=>u.ids.includes(id)||u.ids.some(s=>available.get(s)?.linkedLongId===id)).every(id=>u.action==='merge_short'?u.readOwners.includes(id):u.ids.includes(id)),'summary','missing summary requires a sourced summary repair');
      const longIds=new Set(u.ids.flatMap(id=>{const row=available.get(id)!;return row.kind==='long'?[id]:row.linkedLongId?[row.linkedLongId]:[];}));
      const implicit=snapshot.filter(r=>r.kind==='learned'&&(!!r.canonicalMemoryId&&longIds.has(r.canonicalMemoryId)||r.evidenceMemoryIds?.some(id=>longIds.has(id)))||['merge','merge_short'].includes(u.action)&&r.kind==='short'&&!!r.linkedLongId&&longIds.has(r.linkedLongId)).map(r=>r.id);
      const evidenceOwners=u.action==='promote'?u.readOwners.flatMap(id=>{const row=available.get(id)!;const canonical=row.kind==='short'?row.linkedLongId:row.kind==='learned'?row.canonicalMemoryId:null;return canonical&&available.get(canonical)?.kind==='long'?[canonical]:[];}):[];
      const effectiveReadOwners=[...new Set([...u.readOwners,...implicit,...evidenceOwners])];
      const isolatedOwners=kind==='audit'?u.ids:effectiveReadOwners;
      requireControl(isolatedOwners.every(id=>!touched.has(id)),'ids','duplicate or overlapping unit');isolatedOwners.forEach(id=>touched.add(id));u.ids.forEach(id=>covered.add(id));
      requireControl(u.sourceIds.every(id=>sources.has(id)),'sourceIds','unknown snapshot source');
      if(['refine','merge','merge_short','promote'].includes(u.action)){requireControl(typeof u.content==='string'&&u.content.trim().length>0,'content','required');requireControl(u.sourceIds.length>0,'sourceIds','required');}
      if(['refine','discard','merge'].includes(u.action))for(const id of u.ids){const row=available.get(id)!;if(row.kind==='short'&&row.linkedLongId)requireControl(u.ids.includes(row.linkedLongId),'ids','linked long must be in the same unit');}
      if(u.action==='discard')requireControl(u.ids.every(id=>available.get(id)!.totalAwakenings===0),'discard','cannot discard awakened memory');
      if(u.action==='merge'){requireControl(!!u.canonicalId&&u.ids.includes(u.canonicalId)&&available.get(u.canonicalId)?.kind==='long','canonicalId','long identity required in merge inputs');requireControl(u.ids.filter(id=>available.get(id)!.kind==='long').length>=2,'ids','merge requires at least two long identities');}
      if(u.action==='merge_short'){
        const shorts=u.ids.map(id=>available.get(id)!).filter(r=>r.kind==='short').sort((a,b)=>milliseconds(a.createdAt)-milliseconds(b.createdAt)||(a.id<b.id?-1:a.id>b.id?1:0));
        requireControl(shorts.length>=2,'ids','merge_short requires two shorts');requireControl(u.canonicalShortId===undefined||u.canonicalShortId===shorts[0]?.id,'canonicalShortId','must be earliest createdAt then smallest ID');u.canonicalShortId=shorts[0]!.id;
        requireControl(typeof u.eventSummary==='string'&&!!u.eventSummary.trim()&&typeof u.feelingSummary==='string','eventSummary','merge_short summaries required');
        requireControl(shorts.every(r=>!!r.linkedLongId&&u.readOwners.includes(r.linkedLongId)&&available.get(r.linkedLongId)?.kind==='long'),'readOwners','merge_short linked longs required');
      }
      if(u.action==='promote'){
        requireControl(!!u.learnedKind,'learnedKind','required');requireControl(!!evaluationAt,'evaluationAt','promotion requires frozen evaluation time');requireControl(u.ids.some(id=>promotionEligible(available.get(id)!,evaluationAt!)),'promote','requires active unarchived main and 30 dates');
        const evidence=u.readOwners.flatMap(id=>{const r=available.get(id)!;const canonical=r.kind==='long'?r.id:r.kind==='short'?r.linkedLongId:r.kind==='learned'?r.canonicalMemoryId:null;return canonical&&available.get(canonical)?.kind==='long'?[canonical]:[];});
        if(u.learnedKind==='stable_understanding')requireControl(new Set(evidence).size>=2,'readOwners','requires distinct canonical events');
      }
      if(u.action==='review_detail'||u.action==='review_learned'){
        requireControl(kind==='audit','action','review actions require audit job');const target=u.targetId?available.get(u.targetId):null;
        requireControl(!!target&&u.ids.length===1&&u.ids[0]===target.id&&target.kind===(u.action==='review_detail'?'detail':'learned'),'targetId','review target kind and ids mismatch');
        requireControl(!!u.decision&&(u.action==='review_detail'?['retain','report_conflict']:['retain','suggest_revision','suggest_withdrawal']).includes(u.decision),'decision','invalid review decision');
        if(u.decision!=='retain'){requireControl(u.sourceIds.length>0,'sourceIds','report requires sources');requireControl(!!u.reason?.trim(),'reason','report requires reason');}
      }else requireControl(kind==='consolidation'||u.action==='retain','action','audit may only review or retain');
      return {...u,readSet:effectiveReadOwners.map(id=>{const row=available.get(id)!;return {ownerType:row.ownerType,ownerId:row.ownerId,revision:row.revision,stateVersion:row.stateVersion} as OwnerVersion;})};
    });
    requireControl(selectedIds.every(id=>covered.has(id)),'selectedIds','every selected event requires a unit');
    return units;
  }};
}
export const auditTask=(snapshot:MemoryCandidate[],selectedIds:string[])=>consolidationTask(snapshot,selectedIds,'audit');
