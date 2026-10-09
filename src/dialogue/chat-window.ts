import type {ChatWindowSnapshot,ChatEligibility,ChatRecent} from './types';
const time=(at:string)=>Date.parse(at);
const literal=(a:string,b:string)=>a<b?-1:a>b?1:0;
export function recentFromSnapshot(snapshot:ChatWindowSnapshot,options:{eligibility:ChatEligibility;count:number;visibleIds:ReadonlySet<string>}):ChatRecent {
  const allowed=options.eligibility==='ordinary_narrative'?new Set<string>():options.visibleIds,messages=snapshot.messages.filter(m=>!m.sharedActivityId&&!!m.chatEpisodeId&&(m.direction==='outgoing'||m.seenTurnId!==null||allowed.has(m.id)));
  const ranks=new Map<string,number>();for(const m of messages)ranks.set(m.chatEpisodeId!,Math.max(ranks.get(m.chatEpisodeId!)??-Infinity,time(m.receivedAt)));
  const episodeIds=snapshot.episodes.filter(e=>ranks.has(e.id)).sort((a,b)=>ranks.get(a.id)!-ranks.get(b.id)!||time(a.openedAt)-time(b.openedAt)||literal(a.id,b.id)).slice(-options.count).map(e=>e.id),order=new Map(episodeIds.map((id,i)=>[id,i]));
  return {episodeIds,messages:messages.filter(m=>order.has(m.chatEpisodeId!)).sort((a,b)=>order.get(a.chatEpisodeId!)!-order.get(b.chatEpisodeId!)!||time(a.receivedAt)-time(b.receivedAt)||(a.turnId===b.turnId&&a.outboxSeq!==null&&b.outboxSeq!==null?a.outboxSeq-b.outboxSeq:literal(a.id,b.id)))};
}
