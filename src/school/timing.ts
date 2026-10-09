import type {SchoolPlanItem,RequiredOccurrence} from './types';
import {localTime,milliseconds} from '../time';
import {localDate} from '../environment/scheduler';
const day=(date:string,offset:number)=>new Date(Date.parse(date+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
export function weekStart(at:string,timezone:string){const date=localDate(at,timezone),weekday=new Date(date+'T12:00:00Z').getUTCDay()||7;return day(date,1-weekday);}
function dateClock(date:string,clock:string,timezone:string){const [y,m,d]=date.split('-').map(Number),[h,min]=clock.split(':').map(Number);return localTime(y,m,d,h*60+min,timezone);}
export function schoolItemOccurrences(item:SchoolPlanItem,weeks:string[],now:string,timezone:string):RequiredOccurrence[]{
 const t=item.timing;if(t.kind==='tentative')return [];
 if(t.kind==='once'||t.kind==='deadline'){
  const start=t.kind==='once'?t.startsAt:t.at;if(!start)return [];const end=t.kind==='once'?t.endsAt:null;
  if(milliseconds(end??start)<milliseconds(now))return [];
  return [{occurrenceKey:JSON.stringify([item.id,t.kind==='once'?'once':'deadline']),sourceItemId:item.id,weekStart:null,startsAt:start,endsAt:end,status:'active'}];
 }
 return weeks.flatMap(week=>t.slots.flatMap(slot=>{
  const date=day(week,slot.weekday-1);if(date<t.startsOn||t.endsOn&&date>t.endsOn)return [];
  const startsAt=dateClock(date,slot.start,timezone),endsAt=dateClock(day(date,slot.end<=slot.start?1:0),slot.end,timezone);
  if(milliseconds(endsAt)<milliseconds(now))return [];
  return [{occurrenceKey:JSON.stringify([item.id,slot.slotKey,week]),sourceItemId:item.id,weekStart:week,startsAt,endsAt,status:'active' as const}];
 }));
}
