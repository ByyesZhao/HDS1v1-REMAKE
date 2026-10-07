import { Context } from 'koishi'
import type { DeliveryAction } from '../interaction/delivery-ledger'
import type { PrivateIngressEvent } from '../runtime/private-ingress-event'
import { CREATE_OPERATION_TABLES, type CreateOperationIdentity } from './create-identity'
import {
  InterludeArc, InterludeParticipant, InterludeScene, InterludeStory, NarrativeFact, NarrativeIntent,
  NarrativeEntity, NarrativeEntityRelation, NarrativeMemory, OverlaySnapshot, SchedulePreplanRecord, ScriptEntry, StatePatchProposal, StickerAsset, WebObservation,
  PublicInformationRecord, RetentionStateRecord, WorldDirectorStateRecord, WorldEventArchiveRecord, WorldEventQuarantineRecord, WorldEventRecord,
} from '../types'

declare module 'koishi' {
  interface Tables {
    interlude_incoming_event: PrivateIngressEvent
    interlude_delivery: DeliveryAction
    interlude_story: InterludeStory
    interlude_participant: InterludeParticipant
    interlude_script_entry: ScriptEntry & CreateOperationIdentity
    interlude_memory: NarrativeMemory & CreateOperationIdentity
    interlude_intent: NarrativeIntent & CreateOperationIdentity
    interlude_scene: InterludeScene & CreateOperationIdentity
    interlude_arc: InterludeArc & CreateOperationIdentity
    interlude_fact: NarrativeFact & CreateOperationIdentity
    interlude_entity: NarrativeEntity & CreateOperationIdentity
    interlude_entity_relation: NarrativeEntityRelation & CreateOperationIdentity
    interlude_state_patch: StatePatchProposal & CreateOperationIdentity
    interlude_overlay_snapshot: OverlaySnapshot & CreateOperationIdentity
    interlude_sticker: StickerAsset & CreateOperationIdentity
    interlude_web_observation: WebObservation & CreateOperationIdentity
    interlude_schedule_preplan: SchedulePreplanRecord
    interlude_world_director: WorldDirectorStateRecord
    interlude_world_event: WorldEventRecord
    interlude_world_event_archive: WorldEventArchiveRecord
    interlude_world_event_quarantine: WorldEventQuarantineRecord
    interlude_retention_state: RetentionStateRecord
    interlude_public_information: PublicInformationRecord
  }
}

export function registerTables(ctx: Context) {
  if (!(ctx.model as any).tables?.interlude_incoming_event) ctx.model.extend('interlude_incoming_event', {
    id: 'string(64)', storyId: 'string(255)', participantId: 'string(255)', phase: 'string(16)',
    admissionSeq: 'double', consumed: 'boolean', recoveryPending: 'boolean', identity: 'json', input: 'json', progress: 'json',
    createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', indexes: ['storyId', 'participantId', 'phase'] })
  if (!(ctx.model as any).tables?.interlude_delivery) ctx.model.extend('interlude_delivery', {
    id: 'string(64)', storyId: 'string(255)', participantId: 'string(255)', groupId: 'string(127)', kind: 'string(32)',
    sourceEntryIds: 'json', segments: 'json', status: 'string(16)', createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', indexes: ['storyId', 'participantId', 'status'] })
  registerPublicInformationTable(ctx)
  // Koishi keeps the model registry on the parent context during plugin
  // reloads. Re-registering the same schemas forces minato to rebuild
  // indexes and is a noticeable source of reload latency.
  const existingTables = (ctx.model as any).tables ?? {}
  // Existing installations already have the original tables registered by a
  // parent context. Do not rebuild those schemas on reload, but keep adding
  // genuinely new tables introduced by later releases.
  if (existingTables.interlude_story) {
    // Existing beta installations need new columns as well as new tables.
    // `fields` is used by current Minato; the fallback keeps older registries compatible.
    const fieldsOf = (table: any) => table?.fields ?? table ?? {}
    if (!fieldsOf(existingTables.interlude_script_entry).embedding) {
      ctx.model.extend('interlude_script_entry', { embedding: 'json' })
    }
    if (!fieldsOf(existingTables.interlude_script_entry).embeddingFingerprint) {
      ctx.model.extend('interlude_script_entry', { embeddingFingerprint: 'string(255)' })
    }
    if (!fieldsOf(existingTables.interlude_fact).signals) {
      ctx.model.extend('interlude_fact', { signals: 'json' })
    }
    if (!fieldsOf(existingTables.interlude_fact).knowledge) ctx.model.extend('interlude_fact', { knowledge: 'json' })
    if (!fieldsOf(existingTables.interlude_fact).embeddingFingerprint) {
      ctx.model.extend('interlude_fact', { embeddingFingerprint: 'string(255)' })
    }
    if (!fieldsOf(existingTables.interlude_memory).sourceEntryIds) {
      ctx.model.extend('interlude_memory', { sourceEntryIds: 'json' })
    }
    if (existingTables.interlude_sticker && !fieldsOf(existingTables.interlude_sticker).embedding) {
      ctx.model.extend('interlude_sticker', { embedding: 'json' })
    }
    if (existingTables.interlude_sticker && !fieldsOf(existingTables.interlude_sticker).embeddingFingerprint) {
      ctx.model.extend('interlude_sticker', { embeddingFingerprint: 'string(255)' })
    }
    if (existingTables.interlude_web_observation) {
      const webFields = fieldsOf(existingTables.interlude_web_observation)
      if (!webFields.sourceKind) ctx.model.extend('interlude_web_observation', { sourceKind: 'string(32)' })
      if (!webFields.knowledgeScope) ctx.model.extend('interlude_web_observation', { knowledgeScope: 'string(32)' })
      if (!webFields.expiresAt) ctx.model.extend('interlude_web_observation', { expiresAt: 'timestamp' })
    }
    if (existingTables.interlude_world_director && !fieldsOf(existingTables.interlude_world_director).eventArchive) {
      ctx.model.extend('interlude_world_director', { eventArchive: 'json' })
    }
    if (existingTables.interlude_state_patch && !fieldsOf(existingTables.interlude_state_patch).terminalAt) {
      ctx.model.extend('interlude_state_patch', { terminalAt: 'timestamp' })
    }
    if (existingTables.interlude_state_patch && !fieldsOf(existingTables.interlude_state_patch).relationshipEvidence) {
      ctx.model.extend('interlude_state_patch', { relationshipEvidence: 'json' })
    }
    if (!existingTables.interlude_web_observation) registerWebObservationTable(ctx)
    if (!existingTables.interlude_overlay_snapshot) registerOverlaySnapshotTable(ctx)
    if (!existingTables.interlude_sticker) registerStickerTable(ctx)
    if (!existingTables.interlude_schedule_preplan) registerSchedulePreplanTable(ctx)
    else if (!fieldsOf(existingTables.interlude_schedule_preplan).baselineFingerprint) {
      ctx.model.extend('interlude_schedule_preplan', { baselineFingerprint: 'string(64)' })
    }
    registerWorldDirectorTables(ctx)
    registerRetentionTables(ctx)
    registerEntityTables(ctx)
    registerCreateOperationIdentities(ctx)
    return
  }

  // 故事表保存可追溯的 canon 与可变的当前状态；原始剧本文本不内嵌在这里。
  ctx.model.extend('interlude_story', {
    id: 'string(255)', platform: 'string(63)', selfId: 'string(63)', userId: 'string(127)',
    channelId: 'string(127)', status: 'string(16)', setting: 'json', state: 'json',
    cursorAt: 'timestamp', createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', indexes: ['platform', 'selfId', 'userId'] })

  // A main story belongs to one character/bot identity. Participants point to
  // individual private-message accounts and carry relationship-local state.
  ctx.model.extend('interlude_participant', {
    id: 'string(255)', storyId: 'string(255)', platform: 'string(63)', selfId: 'string(63)',
    userId: 'string(127)', channelId: 'string(127)', personId: 'string(255)',
    displayName: 'string(255)', profile: 'text', relationship: 'text', state: 'json',
    status: 'string(16)', createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', indexes: ['storyId', 'status', 'personId', 'userId'] })

  // 这是事实来源。场景、事实与状态变化都可以回溯到这些不可变的原始条目。
  ctx.model.extend('interlude_script_entry', {
    id: 'unsigned', storyId: 'string(255)', participantId: 'string(255)', kind: 'string(32)', actor: 'string(32)',
    content: 'text', occurredAt: 'timestamp', metadata: 'json', embedding: 'json', embeddingFingerprint: 'string(255)', createdAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'occurredAt'] })

  ctx.model.extend('interlude_memory', {
    id: 'unsigned', storyId: 'string(255)', participantId: 'string(255)', category: 'string(32)', content: 'text',
    importance: 'double', status: 'string(16)', sourceEntryId: 'unsigned', sourceEntryIds: 'json',
    createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'importance'] })

  // intent 是未来的可能性，不是已经发生的剧情；到期后仍需模型重新裁决。
  ctx.model.extend('interlude_intent', {
    id: 'unsigned', storyId: 'string(255)', participantId: 'string(255)', type: 'string(32)', summary: 'text',
    notBefore: 'timestamp', status: 'string(16)', payload: 'json',
    createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'status', 'notBefore'] })

  // 场景摘要是对原始条目的低 token 索引，不替代原文。
  ctx.model.extend('interlude_scene', {
    id: 'unsigned', storyId: 'string(255)', status: 'string(16)',
    startedAt: 'timestamp', endedAt: 'timestamp', hook: 'text', summary: 'text',
    entryCount: 'unsigned', lastEntryId: 'unsigned', createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'status', 'startedAt'] })

  // 剧情弧线比场景更长，用于维持关系和长期事件的方向感。
  ctx.model.extend('interlude_arc', {
    id: 'unsigned', storyId: 'string(255)', status: 'string(16)', title: 'string(255)',
    summary: 'text', sceneCount: 'unsigned', createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'status', 'updatedAt'] })

  // 长期事实按多维信号、重要度与置信度检索，并保留来源条目供审计或重建。
  ctx.model.extend('interlude_fact', {
    knowledge: 'json',
    id: 'unsigned', storyId: 'string(255)', participantId: 'string(255)', scope: 'string(32)', content: 'text',
    importance: 'double', confidence: 'double', signals: 'json', unresolved: 'boolean', embedding: 'json', embeddingFingerprint: 'string(255)', status: 'string(16)', sourceEntryIds: 'json',
    lastSeenAt: 'timestamp', createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'status', 'importance'] })

  // 设定变化先以提案存在，经过证据与阈值检查后才写入 story.state 的 overlay。
  ctx.model.extend('interlude_state_patch', {
    id: 'unsigned', storyId: 'string(255)', participantId: 'string(255)', target: 'string(32)', path: 'string(255)',
    proposedValue: 'text', evidence: 'text', relationshipEvidence: 'json', confidence: 'double', impact: 'string(16)',
    status: 'string(16)', sourceEntryIds: 'json', createdAt: 'timestamp', appliedAt: 'timestamp', terminalAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'status', 'confidence'] })

  registerWebObservationTable(ctx)
  registerOverlaySnapshotTable(ctx)
  registerStickerTable(ctx)
  registerSchedulePreplanTable(ctx)
  registerWorldDirectorTables(ctx)
  registerRetentionTables(ctx)
  registerEntityTables(ctx)
  registerCreateOperationIdentities(ctx)
}

function registerCreateOperationIdentities(ctx: Context) {
  for (const table of CREATE_OPERATION_TABLES) {
    const model = (ctx.model as any).tables?.[table]
    const fields = model?.fields ?? model ?? {}
    const index = { name: `hdsi:${table}:create-operation`, unique: true, keys: { createOperationId: 'asc' as const } }
    if (fields.createOperationId && model?.indexes?.some((item: any) => item.name === index.name && item.unique)) continue
    // Explicit NULL lets every old row coexist; the ordinary string default
    // would make the new unique index collide on empty strings. Named indexes
    // are prepared after ALTER on existing databases as well as new tables.
    ctx.model.extend(table, { createOperationId: { type: 'string', length: 64, nullable: true, initial: null } }, { indexes: [index] })
  }
}

function registerPublicInformationTable(ctx: Context) {
  if ((ctx.model as any).tables?.interlude_public_information) return
  ctx.model.extend('interlude_public_information', {
    storyId: 'string(255)', state: 'json', updatedAt: 'timestamp',
  }, { primary: 'storyId' })
}

/** Kept separately so an upgrade can register only this new table without
 * forcing Minato/sql.js to rebuild every long-lived HDSI index on reload. */
function registerWebObservationTable(ctx: Context) {
  if ((ctx.model as any).tables?.interlude_web_observation) return
  ctx.model.extend('interlude_web_observation', {
    id: 'unsigned', storyId: 'string(255)', participantId: 'string(255)', intentId: 'unsigned',
    mode: 'string(16)', query: 'text', url: 'text', title: 'text', excerpt: 'text', summary: 'text',
    status: 'string(16)', sourceKind: 'string(32)', knowledgeScope: 'string(32)', expiresAt: 'timestamp', accessedAt: 'timestamp', createdAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'status', 'accessedAt'] })
}

/** Snapshot rows keep older overlay evolution compact; superseded snapshots
 * and compacted patch details follow the separate audit-retention policy. */
function registerOverlaySnapshotTable(ctx: Context) {
  if ((ctx.model as any).tables?.interlude_overlay_snapshot) return
  ctx.model.extend('interlude_overlay_snapshot', {
    id: 'unsigned', storyId: 'string(255)', participantId: 'string(255)', target: 'string(32)', tier: 'string(16)',
    periodStart: 'timestamp', periodEnd: 'timestamp', summary: 'text', majorEvents: 'json', sourcePatchIds: 'json',
    status: 'string(16)', createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', autoInc: true, indexes: ['storyId', 'status', 'target', 'periodEnd'] })
}

function registerStickerTable(ctx: Context) {
  if ((ctx.model as any).tables?.interlude_sticker) return
  ctx.model.extend('interlude_sticker', {
    id: 'unsigned', assetId: 'string(255)', filePath: 'string(1024)', group: 'string(128)', mimeType: 'string(127)',
    animated: 'boolean', size: 'unsigned', hash: 'string(64)', description: 'text', aliases: 'json', status: 'string(16)',
    embedding: 'json', embeddingFingerprint: 'string(255)',
    createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'id', autoInc: true, unique: ['assetId'], indexes: ['status', 'group', 'updatedAt'] })
}

function registerSchedulePreplanTable(ctx: Context) {
  if ((ctx.model as any).tables?.interlude_schedule_preplan) return
  ctx.model.extend('interlude_schedule_preplan', {
    storyId: 'string(255)', revision: 'unsigned', timezone: 'string(127)',
    validFrom: 'string(10)', validThrough: 'string(10)', lastReviewedLocalDate: 'string(10)',
    lastEvidenceEntryId: 'unsigned', baselineFingerprint: 'string(64)', reviewReason: 'text', regimes: 'json', exceptions: 'json', materializedDays: 'json',
    createdAt: 'timestamp', updatedAt: 'timestamp',
  }, { primary: 'storyId', indexes: ['validThrough', 'lastReviewedLocalDate'] })
}

/** World state and immutable event identities stay separate from the
 * protagonist's schedule projection. Event status may change, while its
 * revisions JSON preserves why the locked fact changed. */
function registerWorldDirectorTables(ctx: Context) {
  const tables = (ctx.model as any).tables ?? {}
  if (!tables.interlude_world_director) {
    ctx.model.extend('interlude_world_director', {
      storyId: 'string(255)', revision: 'unsigned', timezone: 'string(127)', baselineFingerprint: 'string(64)',
      semester: 'json', lastSemesterKey: 'string(32)', lastWeeklyReviewKey: 'string(10)', lastDailyReviewDate: 'string(10)',
      lastReviewPhase: 'string(16)', lastReviewReason: 'text', eventArchive: 'json', createdAt: 'timestamp', updatedAt: 'timestamp',
    }, { primary: 'storyId', indexes: ['lastWeeklyReviewKey', 'lastDailyReviewDate'] })
  }
  if (!tables.interlude_world_event) {
    ctx.model.extend('interlude_world_event', {
      id: 'string(255)', storyId: 'string(255)', eventKey: 'string(96)', kind: 'string(32)', scope: 'string(32)',
      title: 'string(255)', summary: 'text', participation: 'string(32)', location: 'string(255)', schedule: 'json',
      sourceKind: 'string(32)', sourceLabel: 'string(255)', sourceUrl: 'text', sourceEntryIds: 'json', confidence: 'double',
      locked: 'boolean', knownToCharacter: 'boolean', status: 'string(16)', createdByPhase: 'string(16)', revision: 'unsigned',
      revisions: 'json', createdAt: 'timestamp', updatedAt: 'timestamp',
    }, { primary: 'id', unique: [['storyId', 'eventKey']], indexes: ['storyId', 'status', 'kind'] })
  }
}

function registerRetentionTables(ctx: Context) {
  const tables = (ctx.model as any).tables ?? {}
  if (!tables.interlude_world_event_archive) {
    ctx.model.extend('interlude_world_event_archive', {
      id: 'string(255)', storyId: 'string(255)', eventKey: 'string(96)', entry: 'json',
      endedAt: 'timestamp', archivedAt: 'timestamp',
    }, { primary: 'id', indexes: ['storyId', 'endedAt'] })
  }
  if (!tables.interlude_world_event_quarantine) {
    ctx.model.extend('interlude_world_event_quarantine', {
      id: 'string(255)', storyId: 'string(255)', originalId: 'string(255)', reason: 'text', payload: 'json', quarantinedAt: 'timestamp',
    }, { primary: 'id', indexes: ['storyId', 'quarantinedAt'] })
  }
  if (!tables.interlude_retention_state) {
    ctx.model.extend('interlude_retention_state', {
      storyId: 'string(255)', lastRunAt: 'timestamp', lastSummary: 'json', updatedAt: 'timestamp',
    }, { primary: 'storyId', indexes: ['lastRunAt'] })
  }
}

/** Auto-discovered entities are separate from owner-authored Lore. Relations
 * keep their own evidence lifecycle so a changing edge never rewrites the
 * stable identity card or duplicates an episodic fact. */
function registerEntityTables(ctx: Context) {
  const tables = (ctx.model as any).tables ?? {}
  const fieldsOf = (table: any) => table?.fields ?? table ?? {}
  if (!tables.interlude_entity) {
    ctx.model.extend('interlude_entity', {
      id: 'unsigned', storyId: 'string(255)', participantId: 'string(255)', kind: 'string(32)',
      canonicalName: 'string(255)', normalizedName: 'string(255)', aliases: 'json', summary: 'text',
      confidence: 'double', salience: 'double', status: 'string(16)', sourceEntryIds: 'json',
      firstSeenAt: 'timestamp', lastSeenAt: 'timestamp', createdAt: 'timestamp', updatedAt: 'timestamp',
    }, { primary: 'id', autoInc: true, indexes: ['storyId', 'status', 'normalizedName', 'lastSeenAt'] })
  }
  if (!tables.interlude_entity_relation) {
    ctx.model.extend('interlude_entity_relation', {
      id: 'unsigned', storyId: 'string(255)', participantId: 'string(255)', subjectEntityId: 'unsigned', subjectValue: 'text',
      predicate: 'string(255)', objectEntityId: 'unsigned', objectValue: 'text', confidence: 'double',
      status: 'string(16)', resolution: 'text', sourceEntryIds: 'json', firstSeenAt: 'timestamp', lastSeenAt: 'timestamp',
      createdAt: 'timestamp', updatedAt: 'timestamp',
    }, { primary: 'id', autoInc: true, indexes: ['storyId', 'status', 'subjectEntityId', 'objectEntityId', 'lastSeenAt'] })
  } else if (!fieldsOf(tables.interlude_entity_relation).resolution) {
    ctx.model.extend('interlude_entity_relation', { resolution: 'text' })
  }
}
