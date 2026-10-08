import type {Storage} from '../storage';
import type {Message,TurnRecord} from '../types';
import type {ActivityContextSelection} from './types';
import type {PromptStage} from '../model/context-types';
export function selectActivityContext(storage:Storage,turn:TurnRecord):ActivityContextSelection|null {
 const activityId=turn.sharedMeta?.activityId??(turn.entryMode!=='chat'?storage.character().scene.shared?.activityId:null);
 if(!activityId)return null;
 const selected=new Set(turn.inputMessageIds);
 return {activityId,at:turn.at,messageIds:storage.messages().filter(m=>m.sharedActivityId===activityId&&(selected.has(m.id)||Date.parse(m.receivedAt)<=Date.parse(turn.at)&&(m.direction==='outgoing'||m.seenTurnId!==null))).map(m=>m.id)};
}
export function activityContextMessages(storage:Storage,selection:ActivityContextSelection|null|undefined,stage:PromptStage,visibleIds:string[]):Message[] {
 if(!selection||!['narrative_shared','personal_shared','expression','memory'].includes(stage))return [];
 const visible=new Set(visibleIds);
 return selection.messageIds.map(id=>{const m=storage.read('messages',id);if(!m)throw new Error(`activity context message missing: ${id}`);if(m.sharedActivityId!==selection.activityId)throw new Error(`activity context identity changed: ${id}`);return m;}).filter(m=>m.direction==='outgoing'||m.seenTurnId!==null||visible.has(m.id));
}
