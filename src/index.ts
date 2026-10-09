import {Context,Schema} from 'koishi';
import {resolve} from 'node:path';
import {loadSettings,connectionFor,modelRoles} from './settings';
import {createPluginRuntimeSync} from './deployment/plugin-runtime';
import {installBrowserRuntime} from './deployment/browser-runtime';
export {isTargetSession} from './host/input';
export const name = 'hdsi-remake';
export interface Config { botId: string; userId: string; databasePath: string; storyConfigPath: string }
export const Config: Schema<Config> = Schema.object({
  botId: Schema.string().default('1000000000').description('机器人 QQ 号'),
  userId: Schema.string().default('1000000001').description('目标用户 QQ 号'),
  databasePath: Schema.string().default('data/hdsi-remake.sqlite').description('独立故事数据库路径'),
  storyConfigPath: Schema.string().default('../config.local.json').description('角色、各任务模型和作息配置文件'),
});
export function apply(ctx:Context,config:Config):void{
 const settings=loadSettings(resolve(ctx.baseDir,config.storyConfigPath));
 modelRoles.forEach(role=>connectionFor(settings,role));if(settings.visualInput.enabled)connectionFor(settings,'incoming_image');
 if(settings.webSearch.enabled){
  if(settings.webSearch.provider!=='browser')throw Error('web search enabled but provider not configured');
  require.resolve('koishi-plugin-puppeteer');
  installBrowserRuntime(ctx,config,settings);return;
 }
 const created=Promise.resolve(createPluginRuntimeSync(ctx,config,settings));let disposed=false;
 ctx.on('ready',async()=>{const runtime=await created;if(!disposed)await runtime.host.start();});
 ctx.on('dispose',async()=>{disposed=true;await (await created).close();});
}
