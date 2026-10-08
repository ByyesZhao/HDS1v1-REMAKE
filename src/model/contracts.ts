import { z } from 'zod';
import type { ModelTask, NarrativeResult, SharedNarrativeResult, SharedTurnMeta, SharedOutline, PersonalResult, ExpressionResult, MemoryResult, EnvironmentResult, ScheduledTask, EnvironmentEvent } from '../types';
import { prompts } from './prompts';
import { milliseconds } from '../time';
import type { MemoryCandidate, MaintenanceUnit, OwnerVersion } from '../memory/types';

const text = z.string();
const time = z.iso.datetime({ offset: true });
const emotion = z.object({ label: text, degree: text, reason: text });
const energy = z.object({ level: z.enum(['精力充沛', '正常', '疲惫', '精疲力尽']), reason: text });
const activity = z.object({ description: text, startsAt: time, expectedEndAt: time.nullable(), phoneAccess: z.boolean() });
const narrative = z.object({
  experiences: z.array(z.object({ happenedAt: time, description: text, relatedEventIds: z.array(text) })),
  currentScene: z.object({ description: text, activity: activity.nullable() }), energy,
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
const expression = z.object({ parts: z.array(z.object({ kind: z.enum(['text', 'action']), content: text })) });
const summary = {content:text,eventSummary:text,feelingSummary:text,topics:z.array(text),sourceIds:z.array(text).min(1)};
const eventTimes={happenedAt:time.optional(),happenedUntil:time.optional()};
const memory = z.object({
  schemaVersion:z.literal(3),
  shortTermChanges:z.array(z.discriminatedUnion('action',[z.object({action:z.literal('create'),clientRef:text,...summary,importance:z.enum(['normal','high']),existingLongId:text.optional(),...eventTimes}),z.object({action:z.literal('update'),id:text,...summary,hasNewEventProgress:z.boolean(),...eventTimes})])),
  longTermChanges: z.array(z.object({action:z.literal('awaken'),id:text,reason:text,sourceIds:z.array(text).min(1)})),
  detailChanges: z.array(z.object({ action: z.enum(['create', 'update']), key: text, value: text, aliases: z.array(text), reason: text, sourceIds: z.array(text).min(1) })),
});
const event = z.object({ kind: z.enum(['world', 'school']), startsAt: time, endsAt: time.nullable(), description: text, basis: z.enum(['fiction', 'web_reference']), sourceUrls: z.array(z.url()) });
const environment = z.object({ changes: z.array(z.discriminatedUnion('action', [z.object({ action: z.literal('create'), event }), z.object({ action: z.literal('update'), id: text, event: event.partial() }), z.object({ action: z.literal('cancel'), id: text })])) });

export function modelTask<T>(name: keyof typeof prompts, schema: z.ZodType, validate?: (result: T) => void): ModelTask<T> {
  return { name, schema: z.toJSONSchema(schema), prompt: prompts[name], parse(value) { const result = schema.parse(value) as T; validate?.(result); return result; } };
}
const requireControl = (condition: boolean, path: string, message: string) => { if (!condition) throw new Error(`${path}: ${message}`); };

export function narrativeTask(shared: boolean, from: string, at: string, eventIds: string[] = [], sharedMeta?: SharedTurnMeta | null, previousOutline?: SharedOutline | null): ModelTask<NarrativeResult | SharedNarrativeResult> {
  return modelTask(shared ? 'narrative_shared' : 'narrative', shared ? sharedNarrative : narrative, (r: NarrativeResult | SharedNarrativeResult) => {
    r.experiences.forEach((e, i) => {
      requireControl(milliseconds(e.happenedAt) >= milliseconds(from) && milliseconds(e.happenedAt) <= milliseconds(at), `experiences.${i}.happenedAt`, 'must be within the elapsed interval');
      requireControl(e.relatedEventIds.every(id => eventIds.includes(id)), `experiences.${i}.relatedEventIds`, 'unknown event ID');
    });
    const a = r.currentScene.activity;
    if (a) {
      requireControl(milliseconds(a.startsAt) <= milliseconds(at), 'currentScene.activity.startsAt', 'current activity cannot start in the future');
      requireControl(a.expectedEndAt === null || milliseconds(a.expectedEndAt) >= milliseconds(a.startsAt), 'currentScene.activity.expectedEndAt', 'must follow startsAt');
    }
    if (shared) {
      requireControl(!!sharedMeta, 'sharedMeta', 'shared calls require fixed selection metadata');
      const result = r as SharedNarrativeResult;
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
}

export function personalTask(kind: 'chat' | 'life' | 'shared', at: string, tasks: ScheduledTask[], mode: string, messageIds: string[], sharedMeta?: SharedTurnMeta | null, publicNarration?: string | null): ModelTask<PersonalResult> {
  return modelTask(`personal_${kind}`, kind === 'life' ? life : chat, (r: PersonalResult) => {
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
  });
}
export const expressionTask = () => modelTask<ExpressionResult>('expression', expression);
export function memoryTask(sourceIds: string[], memoryIds: string[], shortIds:string[]=[],selfReadIds:string[]=[]): ModelTask<MemoryResult> {
  return modelTask('memory', memory, (r: MemoryResult) => {
    const validateSources = (ids: string[], allowed=sourceIds) => requireControl(ids.length>0&&ids.every(id => allowed.includes(id)), 'sourceIds', 'unknown current source ID');
    const touched=new Set<string>();const refs=new Set<string>();
    r.shortTermChanges.forEach(c=>{validateSources(c.sourceIds,[...sourceIds,...selfReadIds]);if(c.action==='update'){requireControl(shortIds.includes(c.id)&&!touched.has(c.id),'shortTermChanges.id','unknown or duplicate memory ID');touched.add(c.id);}else{requireControl(!refs.has(c.clientRef),'shortTermChanges.clientRef','duplicate clientRef');refs.add(c.clientRef);if(c.existingLongId)requireControl(memoryIds.includes(c.existingLongId),'existingLongId','unknown memory ID');}});
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

export function consolidationTask(snapshot:MemoryCandidate[],selectedIds:string[]):ModelTask<MaintenanceUnit[]> {
  const unit=z.object({unitKey:text.min(1),action:z.enum(['refine','merge','discard','promote','retain']),readOwners:z.array(text).min(1),ids:z.array(text).min(1),sourceIds:z.array(text),canonicalId:text.optional(),content:text.optional(),eventSummary:text.optional(),feelingSummary:text.optional(),learnedKind:z.enum(['durable_experience','stable_understanding']).optional(),alwaysInclude:z.boolean().optional(),reason:text.optional()});
  const schema=z.object({units:z.array(unit)});
  return {name:'memory_consolidation',prompt:prompts.memory_consolidation,schema:z.toJSONSchema(schema),parse(value:unknown){
    const parsed=schema.parse(value),touched=new Set<string>(),unitKeys=new Set<string>(),covered=new Set<string>();
    const available=new Map(snapshot.map(row=>[row.id,row])),sources=new Set(snapshot.flatMap(row=>row.sourceIds));
    const units=parsed.units.map(u=>{
      requireControl(!unitKeys.has(u.unitKey),'unitKey','duplicate unit');unitKeys.add(u.unitKey);
      requireControl(u.readOwners.every(id=>available.has(id)),'readOwners','unknown snapshot owner');
      requireControl(u.ids.every(id=>u.readOwners.includes(id)),'ids','writes outside readOwners');
      const projectionIds=snapshot.filter(r=>r.kind==='learned'&&r.canonicalMemoryId&&u.ids.includes(r.canonicalMemoryId)).map(r=>r.id);
      const effectiveReadOwners=[...new Set([...u.readOwners,...projectionIds])];
      requireControl(effectiveReadOwners.every(id=>!touched.has(id)),'ids','duplicate or overlapping unit');effectiveReadOwners.forEach(id=>touched.add(id));u.ids.forEach(id=>covered.add(id));
      requireControl(u.sourceIds.every(id=>sources.has(id)),'sourceIds','unknown snapshot source');
      if(['refine','merge','promote'].includes(u.action)){requireControl(typeof u.content==='string'&&u.content.length>0,'content','required');requireControl(u.sourceIds.length>0,'sourceIds','required');}
      if(['refine','discard','merge'].includes(u.action))for(const id of u.ids){const row=available.get(id)!;if(row.kind==='short'&&row.linkedLongId)requireControl(u.ids.includes(row.linkedLongId),'ids','linked long must be in the same unit');}
      if(u.action==='discard')requireControl(u.ids.every(id=>available.get(id)!.totalAwakenings===0),'discard','cannot discard awakened memory');
      if(u.action==='merge'){requireControl(!!u.canonicalId&&u.ids.includes(u.canonicalId)&&available.get(u.canonicalId)?.kind==='long','canonicalId','long identity required in merge inputs');requireControl(u.ids.filter(id=>available.get(id)!.kind==='long').length>=2,'ids','merge requires at least two long identities');}
      if(u.action==='promote'){requireControl(!!u.learnedKind,'learnedKind','required');requireControl(u.ids.some(id=>available.get(id)!.totalAwakenings>=30),'promote','requires 30 dates');if(u.learnedKind==='stable_understanding')requireControl(new Set(u.readOwners.map(id=>available.get(id)!.canonicalMemoryId??available.get(id)!.linkedLongId??id)).size>=2,'readOwners','requires distinct events');}
      return {...u,readSet:effectiveReadOwners.map(id=>{const row=available.get(id)!;return {ownerType:row.ownerType,ownerId:row.ownerId,revision:row.revision,stateVersion:row.stateVersion} as OwnerVersion;})};
    });
    requireControl(selectedIds.every(id=>covered.has(id)),'selectedIds','every selected event requires a unit');
    return units;
  }};
}
