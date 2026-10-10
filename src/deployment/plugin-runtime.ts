import {dirname,join} from 'node:path';
import {IncomingMediaStore} from '../input-media/store';
import {IncomingAssets,AttachmentResolver} from '../input-media/assets';
import {IncomingMediaService} from '../input-media/service';
import {parseIncomingContent} from '../input-media/parse';
import {initializeMissingBackgroundFacts} from '../model/background-views';
import {generateEnvironmentStep} from '../directors/school';
import {importLegacySchoolEvents} from '../deployment/environment-upgrade';
import {inspectEnvironmentAsyncUpgrade} from '../deployment/environment-async-upgrade';
import { Context, Schema, h } from 'koishi';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { Storage } from '../storage';
import { EnvironmentStore } from '../environment/store';
import { SchoolStore } from '../school/store';
import { HdsiApp } from '../app';
import { SerialHost } from '../host/runtime';
import { arrangeSleep, autonomousMinutes } from '../host/state';
import { MemoryStore } from '../memory/store';
import { assembleMemory } from '../deployment/memory-runtime';
import {inspectMemoryCapacity} from '../deployment/memory-capacity-upgrade';
import { assembleWeb } from '../deployment/web-runtime';
import { DialogueEpisodes } from '../dialogue/episodes';
import {ChatEpisodes} from '../dialogue/chat-episodes';
import { DialogueStore } from '../dialogue/store';
import { inspectDialogueUpgrade,ensureDialogueVersion,dialogueUpgradeInstruction } from '../deployment/dialogue-upgrade';
import { inspectSharedUpgrade, ensureSharedActivityVersion } from '../deployment/shared-upgrade';
import { ModelClient, ChatCompletionsTransport } from '../model/client';
import { StickerLibrary, HttpEmbeddingProvider } from '../output/stickers';
import { renderItem } from '../output/qq';
import { systemClock, addMs } from '../time';
import { loadSettings, connectionFor, modelRoles, appConfig, initialState } from '../settings';
import type { Sender } from '../types';
import { isTargetSession,incomingMessageId } from '../host/input';
export { isTargetSession } from '../host/input';

import type {Config} from '../index';
import type {StorySettings} from '../settings';
import type {ManagedBrowserProvider} from '../web/browser/types';
const name='hdsi-remake';
export interface PluginRuntime {host:SerialHost;stopAcceptingInput():void;close(options?:{graceful?:boolean}):Promise<void>}
export async function createPluginRuntime(ctx:Context,config:Config,settings:StorySettings,managedBrowser?:ManagedBrowserProvider):Promise<PluginRuntime>{return createPluginRuntimeSync(ctx,config,settings,managedBrowser);}
export function createPluginRuntimeSync(ctx:Context,config:Config,settings:StorySettings,managedBrowser?:ManagedBrowserProvider):PluginRuntime{
  // Validate deployment prerequisites before creating a formal story database.
  modelRoles.forEach(role => connectionFor(settings, role));
  if(settings.visualInput.enabled)connectionFor(settings,'incoming_image');
  if(settings.webSearch.enabled&&!managedBrowser)throw new Error('web search enabled but provider not configured');
  const databasePath = resolve(ctx.baseDir, config.databasePath);
  if (existsSync(databasePath) && inspectSharedUpgrade(databasePath).version !== 1) throw new Error('Stop HDSI and run npm run shared:migrate -- --database <path> --check before enabling this existing database.');
  if(existsSync(databasePath)&&inspectEnvironmentAsyncUpgrade(databasePath).version!==2)throw new Error('Stop HDSI and run legacy npm run migrate:environment for version null first; then npm run migrate:environment-async -- --database <path> --check, then --apply --stopped --backup-dir <path> before starting this existing database.');
  if(existsSync(databasePath)){const capacity=inspectMemoryCapacity(databasePath,systemClock.now(),settings.memory.capacity);if(capacity.hasCharacter&&capacity.version!==1)throw new Error('Stop HDSI; finish old stories with the previous build; run npm run memory:capacity -- <db> --config <json> --dry-run, then --apply --stopped before starting.');}
  if(existsSync(databasePath)){const check=inspectDialogueUpgrade(databasePath,{targetVersion:2,idleMinutes:settings.memory.contextLimits.dialogueIdleMinutes,recentSegments:settings.memory.contextLimits.recentDialogueSegments});if(check.version!==2||!check.canApply)throw new Error(dialogueUpgradeInstruction(check));}
  const storage = new Storage(databasePath,{dialogueIdleMinutes:settings.memory.contextLimits.dialogueIdleMinutes});
  try { ensureDialogueVersion(storage);ensureSharedActivityVersion(storage); } catch (error) { storage.close(); throw error; }
  const memoryStore=new MemoryStore(storage),fresh=!storage.get('character');
  if(!fresh&&memoryStore.schemaVersion()!==3){storage.close();throw new Error('Stop HDSI and run npm run memory:migrate -- --stopped before starting this existing database');}
  const random = { next: () => Math.random() }, clock = systemClock, options = appConfig(settings);
  if (!storage.get('character')) {
    storage.transaction(() => {
      const state = initialState(settings, clock.now());
      state.sleep ??= arrangeSleep(state, clock.now(), options, random, []);
      state.nextAutonomousAt = addMs(clock.now(), autonomousMinutes(random) * 60_000);
      storage.set('character', state); storage.set('background', settings.background);
      settings.initialDetails.forEach(detail => memoryStore.saveOwner(memoryStore.makeOwner({ownerType:'detail',ownerId:detail.key},{...detail,content:detail.value,effectiveAt:clock.now()},clock.now())));
      settings.initialEvents.forEach(event => storage.save('events', event.id, event));
      importLegacySchoolEvents(storage,clock.now(),options.timezone);
      storage.set('runtime', { ...storage.runtime(), nextWorldAt:null,nextSchoolAt:null,nextEnvironmentAt:null });
    });
  }
  if(fresh)memoryStore.migrate(clock.now());
  if(fresh)memoryStore.migrateCapacity(clock.now());
  storage.transaction(()=>initializeMissingBackgroundFacts(memoryStore,options.backgroundViews,clock.now()));
  let stickers: StickerLibrary | undefined;
  if (options.stickersEnabled) {
    const e = settings.embedding;
    if (!e || !process.env[e.apiKeyEnv]) { storage.close(); throw new Error('configure qwen embedding before enabling stickers'); }
    stickers = new StickerLibrary(storage, new HttpEmbeddingProvider(e.model, e.baseUrl, process.env[e.apiKeyEnv]!, fetch, e.dimensions));
    try { stickers.checkReady(); } catch (error) { storage.close(); throw error; }
  }
  const mediaStore=new IncomingMediaStore(storage);
  const mediaAssets=new IncomingAssets(mediaStore,join(dirname(databasePath),'incoming-media'),new AttachmentResolver(fetch,async file=>{const b=bot() as unknown as {getImage?:(file:string)=>Promise<{url?:string;base64?:string}>;internal?:{getImage?:(file:string)=>Promise<{url?:string;base64?:string}>}};const api=b.internal?.getImage?b.internal:b;return api.getImage?api.getImage(file):{};}));
  const models = new ModelClient(new ChatCompletionsTransport(task => connectionFor(settings, task),fetch,ref=>mediaAssets.resolveImageAsset(ref)));
  const web=assembleWeb(storage,settings,clock,managedBrowser?.provider);
  const incomingMedia=new IncomingMediaService(mediaStore,mediaAssets,models,{enabled:settings.visualInput.enabled,recentSegments:settings.memory.contextLimits.recentDialogueSegments},web);
  void incomingMedia.primeStickerObservations();
  let host:SerialHost;
  let memory:ReturnType<typeof assembleMemory>;
  try{memory=assembleMemory(storage,settings,models,clock,()=>void host.wake(),process.env,memoryStore,web);}catch(error){storage.close();throw error;}
  const bot = () => {
    const found = ctx.bots.find(bot => bot.selfId === config.botId);
    if (!found) throw new Error('bound QQ bot is not available');
    return found;
  };
  const sender: Sender = {
    async sendItem(item) {
      let content: string | ReturnType<typeof h.image> = renderItem(item);
      if (item.kind === 'sticker') {
        const sticker = storage.read('stickers', item.payload)!;
        const extension = extname(sticker.path).toLowerCase();
        const mime = extension === '.gif' ? 'image/gif' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png';
        content = h.image(readFileSync(sticker.path), mime);
      }
      return { platformMessageIds: await bot().sendPrivateMessage(config.userId, content) };
    },
    async sendError(message) { await bot().sendPrivateMessage(config.userId, message); },
  };
  const app = new HdsiApp({
    incomingMedia,chat:new ChatEpisodes(new DialogueStore(storage),settings.memory.contextLimits.dialogueIdleMinutes),dialogue:new DialogueEpisodes(new DialogueStore(storage),settings.memory.contextLimits.dialogueIdleMinutes),environmentStore:new EnvironmentStore(storage),schoolStore:new SchoolStore(storage),storage, clock, random, models, config: options, sender, stickers,web,memoryStore:memory.store,memoryLifecycle:memory.lifecycle,memoryCapacity:memory.capacity,memoryIdle:memory.idle,memoryCleanup:memory.cleanup,retrieval:memory.retrieval,maintenance:memory.maintenance,
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
  });
  app.dependencies.generateEnvironment=(input,execution)=>generateEnvironmentStep(app.dependencies,input,execution);
  const logger = ctx.logger(name);
  host = new SerialHost(app, { onError: error => logger.error(error), onWarning: warning => logger.warn(warning) });
  let accepting=true;
  ctx.middleware(async (session, next) => {
    if(!accepting)return next();
    if (!isTargetSession(session, config)) return next();
    const rawContent = session.content ?? '';
    if (/^hdsi\.(status|pause|resume)(?:\s|$)/.test(rawContent.trim())) return next();
    const messageId=incomingMessageId(session),parsed=parseIncomingContent(messageId,rawContent),text=parsed.content;
    if (!text.trim()) return;
    const accepted = await host.acceptInput({ id: messageId, receivedAt: clock.now(), ...parsed, platformMessageIds: session.messageId ? [session.messageId] : [] });
    if (accepted.systemReply) await bot().sendPrivateMessage(config.userId, accepted.systemReply);
  });
  for (const command of (managedBrowser?['pause','resume']:['status','pause','resume']) as Array<'status'|'pause'|'resume'>) {
    ctx.command(`hdsi.${command}`, command === 'status' ? '故事状态' : command === 'pause' ? '暂停新故事回合' : '恢复故事', { authority: 0 }).action(async ({ session }) => {
      if (!session || !isTargetSession(session, config)) return;
      if (command === 'pause') await host.pause();
      if (command === 'resume') void host.resume();
      return host.status();
    });
  }
  let closing:Promise<void>|null=null;
  return {host,stopAcceptingInput(){accepting=false;},close(options:{graceful?:boolean}={}){accepting=false;return closing??=(async()=>{await host.stop(options);await incomingMedia.stop(options);await managedBrowser?.dispose();storage.close();})();}};
}
