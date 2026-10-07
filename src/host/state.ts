import { randomUUID } from 'node:crypto';
import type { CharacterState, Random, ScheduledTask, TaskChange, TaskDetails, SleepPreference } from '../types';
import type { AppConfig } from '../config';
import { milliseconds, localParts, localTime } from '../time';
import { hasValidSharedScene } from './shared';

export function isSleeping(state: CharacterState, now: string): boolean {
  if (hasValidSharedScene(state)) return false;
  return !!state.sleep && milliseconds(state.sleep.sleepAt) <= milliseconds(now) && milliseconds(now) < milliseconds(state.sleep.wakeAt);
}
export function canRead(state: CharacterState, now: string): boolean {
  if (isSleeping(state, now)) return false;
  if (hasValidSharedScene(state)) return true;
  const a = state.scene.activity;
  return !a || a.phoneAccess || milliseconds(a.startsAt) > milliseconds(now)
    || (a.expectedEndAt !== null && milliseconds(now) >= milliseconds(a.expectedEndAt));
}

export function autonomousMinutes(random: Random): number { return 150 + Math.floor(random.next() * 61); }

export function arrangeSleep(state: CharacterState, at: string, config: AppConfig, random: Random, tasks: ScheduledTask[], preference?: SleepPreference, nextNight = false): CharacterState['sleep'] {
  const p = localParts(at, config.timezone);
  const minute = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m; };
  const h = config.sleepHabits;
  const start = minute(h.sleepStart); let end = minute(h.sleepEnd); if (end < start) end += 1440;
  const wakeStart = minute(h.wakeStart), wakeEnd = minute(h.wakeEnd);
  const shift = state.energy.level === '疲惫' ? 30 : state.energy.level === '精疲力尽' ? 60 : 0;
  const day = p.day - (!nextNight && p.hour * 60 + p.minute < wakeStart ? 1 : 0);
  let sleep = state.sleep;
  if (!sleep || nextNight) {
    const sleepAt = localTime(p.year, p.month, day, start - shift + Math.floor(random.next() * (end - start + 1)), config.timezone);
    const wakeAt = localTime(p.year, p.month, day + 1, wakeStart + Math.floor(random.next() * (wakeEnd - wakeStart + 1)), config.timezone);
    sleep = { sleepAt: milliseconds(sleepAt) < milliseconds(at) ? at : sleepAt, wakeAt };
  }
  if (preference?.sleepAt) sleep = { ...sleep, sleepAt: milliseconds(preference.sleepAt) < milliseconds(at) ? at : preference.sleepAt };
  if (preference?.wakeAt) sleep = { ...sleep, wakeAt: preference.wakeAt };
  // Only appointments in this night's following morning shorten the chosen wake time.
  const sleepParts = localParts(sleep.sleepAt, config.timezone);
  const nightDay = sleepParts.day - (sleepParts.hour * 60 + sleepParts.minute < wakeStart ? 1 : 0);
  const morningEnd = localTime(sleepParts.year, sleepParts.month, nightDay + 1, wakeEnd, config.timezone);
  for (const task of tasks) {
    if (task.kind !== 'appointment' || task.status !== 'pending') continue;
    if (milliseconds(task.at) > milliseconds(sleep.sleepAt) && milliseconds(task.at) <= milliseconds(morningEnd)) {
      const preparedAt = new Date(milliseconds(task.at) - h.preparationMinutes * 60_000).toISOString();
      if (milliseconds(preparedAt) < milliseconds(sleep.wakeAt)) sleep = { ...sleep, wakeAt: preparedAt };
    }
  }
  if (milliseconds(sleep.wakeAt) <= milliseconds(sleep.sleepAt)) throw new Error('sleep.wakeAt: must follow sleepAt; adjust the appointment or sleep preference');
  return sleep;
}

export function replaceTaskChange(changes: TaskChange[], change: TaskChange): void {
  if (change.action !== 'create') {
    const index = changes.findIndex(c => c.action !== 'create' && c.id === change.id);
    if (index >= 0) { changes[index] = change; return; }
  }
  changes.push(change);
}

export function maintainTask(changes: TaskChange[], old: ScheduledTask | undefined, details: TaskDetails | null): void {
  if (old) replaceTaskChange(changes, details ? { action: 'update', id: old.id, task: details } : { action: 'cancel', id: old.id });
  else if (details) changes.push({ action: 'create', id: randomUUID(), task: details });
}
