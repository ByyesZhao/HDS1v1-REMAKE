import {assertRoutineWindow,windowOptions,assertActiveWindow} from '../dialogue/active-consistency';
import { DialogueEpisodes } from '../dialogue/episodes';
import {ChatEpisodes} from '../dialogue/chat-episodes';
import { DialogueStore } from '../dialogue/store';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, InputAcceptance } from '../types';
import { Storage } from '../storage';
import { addMs, due } from '../time';
import { sharedRoutingActivity, refreshSharedStep } from './shared';
import type {MemoryIdle} from '../memory/idle';

export function isTargetSession(session: { isDirect?: boolean; selfId?: string; userId?: string }, config: { botId: string; userId: string }): boolean {
  return session.isDirect === true && session.selfId === config.botId && session.userId === config.userId;
}

export function incomingMessageId(session:{platform?:string;selfId?:string;userId?:string;channelId?:string;messageId?:string}):string {
  return session.messageId ? `platform:${JSON.stringify([session.platform,session.selfId,session.userId,session.channelId,session.messageId])}` : randomUUID();
}

export class InputBuffer {
  private readonly dialogue:DialogueEpisodes|ChatEpisodes;
  constructor(private readonly storage: Storage,private readonly idle?:MemoryIdle,dialogue?:DialogueEpisodes,chat?:ChatEpisodes) {this.dialogue=storage.runtime().dialogueContextVersion===2?chat??new ChatEpisodes(new DialogueStore(storage)):dialogue??new DialogueEpisodes(new DialogueStore(storage));}
  async acceptInput(message: IncomingMessage): Promise<InputAcceptance> {
    if(this.storage.runtime().dialogueContextVersion===2)assertRoutineWindow(this.storage,windowOptions(this.storage));
    return this.storage.transaction(() => {
      const existing=this.storage.read('messages',message.id),control=this.storage.read('control_requests',message.id);
      if(existing||control)return {kind:control?'advance':'message',systemReply:null};
      this.idle?.record('input',message.receivedAt);
      const activity = sharedRoutingActivity(this.storage);
      if (message.content.trim() === '【推进】') {
        this.storage.save('control_requests', message.id, { id: message.id, receivedAt: message.receivedAt,
          platformMessageIds: message.platformMessageIds ?? [], activityId: activity?.activityId ?? null,
          status: activity ? 'pending' : 'cancelled', consumedTurnId: null });
        return { kind: 'advance', systemReply: activity ? null : '当前没有共同活动' };
      }
      if (activity) {
        this.dialogue.acceptMessage({ ...message, platformMessageIds: message.platformMessageIds ?? [],
          direction: 'incoming', batchId: null, sharedActivityId: activity.activityId, seenTurnId: null, turnId: null, outboxSeq: null });
        const runtime = this.storage.runtime();
        if (runtime.sharedClock?.activityId === activity.activityId) {
          const old = runtime.sharedClock.lastInputAt;
          runtime.sharedClock.lastInputAt = old && Date.parse(old) > Date.parse(message.receivedAt) ? old : message.receivedAt;
          this.storage.set('runtime', runtime);
        }
        refreshSharedStep(this.storage, message.receivedAt);
        return { kind: 'message', systemReply: null };
      }
      this.closeExpired(message.receivedAt);
      const runtime = this.storage.runtime();
      const batchId = runtime.openBatch?.id ?? randomUUID();
      this.dialogue.acceptMessage({
        ...message, platformMessageIds: message.platformMessageIds ?? [], direction: 'incoming',
        batchId, sharedActivityId: null, seenTurnId: null, turnId: null, outboxSeq: null,
      });
      runtime.activeDialogueEpisodeId=this.storage.runtime().activeDialogueEpisodeId;
      runtime.activeChatEpisodeId=this.storage.runtime().activeChatEpisodeId;
      runtime.openBatch = { id: batchId, readyAt: addMs(message.receivedAt, 15_000) };
      this.storage.set('runtime', runtime);
      assertActiveWindow(this.storage,{requiredMessageIds:[message.id]});
      return { kind: 'message', systemReply: null };
    });
  }
  closeReady(now: string): void { this.storage.transaction(() => this.closeExpired(now)); }
  private closeExpired(now: string): void {
    const runtime = this.storage.runtime();
    if (runtime.openBatch && due(runtime.openBatch.readyAt, now)) {
      runtime.pendingBatchIds.push(runtime.openBatch.id);
      runtime.openBatch = null;
      this.storage.set('runtime', runtime);
    }
  }
}
