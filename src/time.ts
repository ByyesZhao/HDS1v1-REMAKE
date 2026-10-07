import type { ISOTime, Clock } from './types';

export const milliseconds = (time: ISOTime): number => Date.parse(time);
export const addMs = (time: ISOTime, delta: number): ISOTime => new Date(milliseconds(time) + delta).toISOString();
export const due = (time: ISOTime | null, now: ISOTime): boolean => time !== null && milliseconds(time) <= milliseconds(now);
export const systemClock: Clock = { now: () => new Date().toISOString() };

export function localParts(time: ISOTime, timezone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(time));
  const value = (key: string) => Number(parts.find(p => p.type === key)!.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute') };
}

// Local calendar fields are translated to the shared epoch; no ISO string ordering.
export function localTime(year: number, month: number, day: number, minuteOfDay: number, timezone: string): ISOTime {
  const target = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  let epoch = target;
  for (let i = 0; i < 3; i++) {
    const p = localParts(new Date(epoch).toISOString(), timezone);
    epoch += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  }
  return new Date(epoch).toISOString();
}

export function nextDaily(now: ISOTime, times: string[], timezone: string): ISOTime {
  const p = localParts(now, timezone);
  const candidates = [0, 1].flatMap(offset => times.map(time => {
    const [h, m] = time.split(':').map(Number);
    return localTime(p.year, p.month, p.day + offset, h * 60 + m, timezone);
  })).filter(t => milliseconds(t) > milliseconds(now));
  return candidates.sort((a, b) => milliseconds(a) - milliseconds(b))[0];
}
