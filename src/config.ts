import type { CharacterState } from './types';

export interface ModelConnection {
  baseUrl: string; apiKey: string; model: string;
  outputMode?: 'json_object' | 'json_schema' | 'prompt';
  reasoningEffort?: 'none' | 'low' | 'high' | 'max';
}
export interface SleepHabits { sleepStart: string; sleepEnd: string; wakeStart: string; wakeEnd: string; preparationMinutes: number }
export interface AppConfig {
  timezone: string; background: string; chatExamples: string; worldSetting: string; schoolSetting: string;
  sleepHabits: SleepHabits; worldTimes: string[]; schoolTimes: string[];
  historyBudget: number|null; stickersEnabled: boolean;
  sharedIdleSeconds: number; sharedMaxSteps: number;
}
export const defaultConfig: AppConfig = {
  timezone: 'Asia/Shanghai', background: '', chatExamples: '', worldSetting: '', schoolSetting: '',
  sleepHabits: { sleepStart: '23:30', sleepEnd: '00:30', wakeStart: '08:00', wakeEnd: '09:00', preparationMinutes: 60 },
  worldTimes: ['06:00'], schoolTimes: ['06:10', '16:00'], historyBudget: null, stickersEnabled: false,
  sharedIdleSeconds: 60, sharedMaxSteps: 20,
};
export function initialCharacter(now: string): CharacterState {
  return {
    narratedUntil: now, scene: { mode: 'chat', description: '开发样例：正在宿舍休息', activity: null, shared: null },
    emotions: [], energy: { level: '正常', reason: '开发初始状态' }, sleep: null, nextAutonomousAt: null, plan: '按照学校安排生活',
  };
}
