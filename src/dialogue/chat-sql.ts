import type {Storage} from '../storage';
import type {ChatWindowQuery,ChatWindowSnapshot,ChatEpisode} from './types';
import type {Message} from '../types';
export const ordinaryChatPredicate="COALESCE(json_extract(data,'$.sharedActivityId'),'')='' AND COALESCE(json_extract(data,'$.chatEpisodeId'),'')!=''";
export const baseChatPredicate=ordinaryChatPredicate+" AND (json_extract(data,'$.direction')='outgoing' OR COALESCE(json_type(data,'$.seenTurnId'),'missing')!='null')";
export function recentChatSnapshot(storage:Storage,options:ChatWindowQuery):ChatWindowSnapshot {
 const fallback=()=>({messages:storage.messages(),episodes:storage.all('chat_episodes')});
 if(!Number.isInteger(options.count)||options.count<=0)return fallback();
 const visible=options.eligibility==='ordinary_narrative'?[]:[...new Set(options.visibleIds)],visibleSQL=visible.length?`UNION ALL SELECT json_extract(data,'$.chatEpisodeId') AS id,hdsi_epoch_ms(json_extract(data,'$.receivedAt')) AS rank,hdsi_epoch_ms(json_extract(data,'$.receivedAt')) IS NULL AS invalidTime FROM messages WHERE id IN (SELECT value FROM json_each(?)) AND ${ordinaryChatPredicate}`:'';
 const sql=`WITH ranks AS (
 SELECT MAX(json_extract(data,'$.chatEpisodeId')) AS id,MAX(hdsi_epoch_ms(json_extract(data,'$.receivedAt'))) AS rank,MAX(hdsi_epoch_ms(json_extract(data,'$.receivedAt')) IS NULL) AS invalidTime FROM messages WHERE ${baseChatPredicate} GROUP BY json_extract(data,'$.chatEpisodeId')
 ${visibleSQL}
 ),combined AS (SELECT id,MAX(rank) AS rank,MAX(invalidTime) AS invalidTime FROM ranks GROUP BY id),
 joined AS (SELECT c.id,c.rank,hdsi_epoch_ms(json_extract(e.data,'$.openedAt')) AS openedEpoch,c.invalidTime OR hdsi_epoch_ms(json_extract(e.data,'$.openedAt')) IS NULL AS invalidTime FROM combined c JOIN chat_episodes e ON e.id=c.id),
 ranked AS (SELECT *,MAX(invalidTime) OVER () AS anyInvalidTime,RANK() OVER (ORDER BY rank DESC,openedEpoch DESC) AS boundary FROM joined)
 SELECT id,rank,openedEpoch,anyInvalidTime AS invalidTime FROM ranked WHERE boundary<=?`;
 const candidates=storage.prepare(sql).all(...visible.length?[JSON.stringify(visible),options.count]:[options.count]) as unknown as Array<{id:string;rank:number;openedEpoch:number;invalidTime:number}>;
 if(candidates.some(r=>r.invalidTime))return fallback();
 const ids=candidates.sort((a,b)=>a.rank-b.rank||a.openedEpoch-b.openedEpoch||(a.id<b.id?-1:a.id>b.id?1:0)).slice(-options.count).map(r=>r.id);
 if(!ids.length)return {messages:[],episodes:[]};
 const episodes=storage.prepare('SELECT data FROM chat_episodes WHERE id IN (SELECT value FROM json_each(?)) ORDER BY rowid').all(JSON.stringify(ids)).map(r=>JSON.parse(String(r.data)) as ChatEpisode);
 const extra=visible.length?" OR id IN (SELECT value FROM json_each(?))":'';
 const messages=storage.prepare(`SELECT rowid,data FROM messages WHERE json_extract(data,'$.chatEpisodeId') IN (SELECT value FROM json_each(?)) AND ${ordinaryChatPredicate} AND (json_extract(data,'$.direction')='outgoing' OR COALESCE(json_type(data,'$.seenTurnId'),'missing')!='null'${extra}) ORDER BY rowid`).all(...visible.length?[JSON.stringify(ids),JSON.stringify(visible)]:[JSON.stringify(ids)]).map(r=>JSON.parse(String(r.data)) as Message).sort((a,b)=>Date.parse(a.receivedAt)-Date.parse(b.receivedAt));
 return {messages,episodes};
}
