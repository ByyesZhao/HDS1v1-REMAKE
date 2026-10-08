import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { AppConfig, ModelConnection } from './config';
import { defaultConfig } from './config';
import type { Scene, CharacterState, EnvironmentEvent, Detail } from './types';
import { loadLocalCredentials } from './deployment/credentials';

export const modelRoles = ['narrative', 'narrative_shared', 'personal_chat', 'personal_life', 'personal_shared', 'expression', 'memory', 'memory_consolidation', 'world', 'school_campus','school_group','school_week'] as const;
export function normalizeSchoolModels(raw:unknown):unknown {
  if(!raw || typeof raw!=='object' || Array.isArray(raw)) return raw;
  const input=structuredClone(raw) as Record<string,any>;
  if(input.models && typeof input.models==='object') {
    for(const role of ['school_campus','school_group','school_week']) {
      if(!(role in input.models) && input.models.school!==undefined) input.models[role]=structuredClone(input.models.school);
    }
  }
  return input;
}
const connection = z.object({
  baseUrl: z.url().default('https://api.deepseek.com'), apiKeyEnv: z.string().default('DEEPSEEK_API_KEY'),
  model: z.enum(['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-pro']),
  outputMode: z.enum(['json_object', 'json_schema', 'prompt']).default('json_object'),
  reasoningEffort: z.enum(['none', 'low', 'high', 'max']).default('high'),
});
const time = z.iso.datetime({ offset: true });
const initialScene = z.object({ description: z.string(), activity: z.object({ description: z.string(), startsAt: time, expectedEndAt: time.nullable(), phoneAccess: z.boolean() }).nullable().default(null) });
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const nullableLimit=z.number().int().positive().nullable().default(null);
const embedding=z.object({baseUrl:z.url().default('https://dashscope.aliyuncs.com/compatible-mode/v1'),apiKeyEnv:z.string().default('QWEN_API_KEY'),model:z.string().min(1).default('qwen3.7-text-embedding'),dimensions:z.number().int().positive().default(1024)});
const memorySettings=z.object({
  capacity:z.object({shortActiveLimit:z.number().int().positive().nullable().default(100),longActiveLimit:z.number().int().positive().nullable().default(1000),longArchiveLimit:z.number().int().positive().nullable().default(500),archiveRetentionDays:z.number().int().positive().nullable().default(90)}).prefault({}),
  idleMaintenanceMinutes:z.number().positive().default(15),maintenanceDuringSleep:z.boolean().default(true),
  contextLimits:z.object({alwaysIncludeCharactersLimit:nullableLimit,candidateItemsPerRoute:nullableLimit,detailItemsLimit:nullableLimit,shortItemsLimit:nullableLimit,longItemsLimit:nullableLimit,recentMessagesLimit:z.number().int().positive().default(30)}).default({alwaysIncludeCharactersLimit:null,candidateItemsPerRoute:null,detailItemsLimit:null,shortItemsLimit:null,longItemsLimit:null,recentMessagesLimit:30}),
  batchItems:z.number().int().positive().default(20),batchCharacters:nullableLimit,
  queryTimeoutMs:z.number().positive().default(1500),backgroundTimeoutMs:z.number().positive().default(120000),retryDelayMs:z.number().positive().default(300000),cacheSize:z.number().int().positive().default(256),cacheTtlMs:z.number().positive().default(600000),calibrationFile:z.string().optional(),
}).prefault({});
export const memoryMaintenanceSettings=memorySettings;
const settingsSchema = z.object({
  background: z.string().min(1), backgroundFile: z.string().optional(), chatExamples: z.string().min(1), worldSetting: z.string(), schoolSetting: z.string(),
  timezone: z.string().default('Asia/Shanghai'), initialScene, initialPlan: z.string(),
  initialEnergy: z.object({ level: z.enum(['精力充沛', '正常', '疲惫', '精疲力尽']), reason: z.string() }).default({ level: '正常', reason: '初始设定' }),
  initialSleep: z.object({ sleepAt: time, wakeAt: time }).nullable().default(null),
  initialDetails: z.array(z.object({ key: z.string(), value: z.string(), aliases: z.array(z.string()) })).default([]),
  initialEvents: z.array(z.object({ id: z.string(), kind: z.enum(['world', 'school']), startsAt: time, endsAt: time.nullable(), description: z.string(), basis: z.literal('fiction'), sourceUrls: z.array(z.string()).length(0), status: z.literal('active') })).default([]),
  sleepHabits: z.object({ sleepStart: clockTime, sleepEnd: clockTime, wakeStart: clockTime, wakeEnd: clockTime, preparationMinutes: z.number().nonnegative() }).default(defaultConfig.sleepHabits),
  worldTimes: z.array(clockTime).min(1).default(defaultConfig.worldTimes), schoolTimes: z.array(clockTime).min(1).default(defaultConfig.schoolTimes),
  environmentDailyAt:clockTime.default('06:00'),environmentRetryMs:z.number().positive().default(300000),
  historyBudget: nullableLimit, stickersEnabled: z.boolean().default(false),memory:memorySettings,memoryEmbedding:embedding.prefault({}),
  sharedIdleSeconds: z.number().int().positive().default(60), sharedMaxSteps: z.number().int().min(1).max(20).default(20),
  models: z.object(Object.fromEntries(modelRoles.map(role => [role, role.startsWith('school_')?connection.extend({reasoningEffort:z.enum(['none','low','high','max']).default('low')}):connection])) as Record<typeof modelRoles[number], typeof connection>),
  stickerDescriptionModel: connection.optional(),
  embedding: embedding.optional(),
  webSources: z.array(z.url({protocol:/^https?$/})).default([]),
  webSearch:z.object({enabled:z.boolean().default(false),maxSuccessReads:z.literal(20).default(20),maxFailures:z.literal(40).default(40)}).prefault({}),
});
export type StorySettings = z.infer<typeof settingsSchema>;
export function loadSettings(path: string, environment: Record<string, string | undefined> = process.env): StorySettings {
  const input = JSON.parse(readFileSync(path, 'utf8'));
  if (input.backgroundFile) input.background = readFileSync(resolve(dirname(path), input.backgroundFile), 'utf8');
  const settings = settingsSchema.parse(normalizeSchoolModels(input));
  if(settings.memory.calibrationFile)settings.memory.calibrationFile=resolve(dirname(path),settings.memory.calibrationFile);
  new Intl.DateTimeFormat('zh-CN', { timeZone: settings.timezone });
  if (settings.initialSleep && Date.parse(settings.initialSleep.wakeAt) <= Date.parse(settings.initialSleep.sleepAt)) throw new Error('initialSleep.wakeAt must follow sleepAt');
  loadLocalCredentials(join(dirname(path), 'key.txt'), environment);
  return settings;
}
export function appConfig(settings: StorySettings): AppConfig { return { ...defaultConfig, ...settings }; }
export function connectionFor(settings: StorySettings, task: string, environment = process.env): ModelConnection {
  const c = task === 'sticker_description' ? settings.stickerDescriptionModel : settings.models[task as typeof modelRoles[number]];
  if (!c) throw new Error(`configure model for ${task}`);
  const apiKey = environment[c.apiKeyEnv];
  if (!apiKey) throw new Error(`set ${c.apiKeyEnv} before enabling HDSI`);
  return { baseUrl: c.baseUrl, apiKey, model: c.model, outputMode: c.outputMode, reasoningEffort: c.reasoningEffort };
}
export function initialState(settings: StorySettings, now: string): CharacterState {
  const scene: Scene = { ...settings.initialScene, mode: 'chat', shared: null };
  return { narratedUntil: now, scene, plan: settings.initialPlan, emotions: [], energy: settings.initialEnergy, sleep: settings.initialSleep, nextAutonomousAt: null };
}
