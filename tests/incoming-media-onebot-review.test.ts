import {it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';import {resolve,join} from 'node:path';import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';
import {parseIncomingContent} from '../src/input-media/parse';import {AttachmentResolver} from '../src/input-media/assets';import {createPluginRuntimeSync} from '../src/deployment/plugin-runtime';import {loadSettings} from '../src/settings';import {Storage} from '../src/storage';
vi.mock('koishi',async()=>(await import('node:module')).createRequire(process.cwd()+'/package.json')('koishi'));
const {OneBot}=createRequire(resolve('runtime/package.json'))('koishi-plugin-adapter-onebot');
const png=Buffer.from('89504e470d0a1a0a00000000','hex');
async function adapted(){return await OneBot.adaptMessage({platform:'onebot',config:{advanced:{splitMixedContent:false}}},{message_id:1,message:[{type:'image',data:{file:'opaque.image'}}],sender:{user_id:2,nickname:'synthetic'},time:1});}
it('actual installed OneBot token shape reaches platform resolution without fetching a token as URL',async()=>{
 const message=await adapted(),a=parseIncomingContent('m',message.content).attachments[0],getImage=vi.fn(async()=>({base64:png.toString('base64')})),fetcher=vi.fn();
 expect(message.content).toContain('src="opaque.image"');
 expect((await new AttachmentResolver(fetcher as any,getImage).resolve(a)).bytes).toEqual(png);
 expect(getImage).toHaveBeenCalledWith('opaque.image');expect(fetcher).not.toHaveBeenCalled();
});
it('runtime assembly uses bound OneBot internal.getImage and persists downloaded bytes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'hdsi-onebot-review-'));let runtime:any,db:Storage|undefined,middleware:any;
 vi.stubEnv('DEEPSEEK_API_KEY','synthetic');vi.stubEnv('QWEN_API_KEY','synthetic');
 const internal={getImage:vi.fn(async function(this:any,file:string){expect(this).toBe(internal);expect(file).toBe('opaque.image');return {base64:png.toString('base64')};})};
 try{
 const sample=JSON.parse(readFileSync('examples/story.sample.json','utf8'));sample.visualInput={enabled:true};sample.stickersEnabled=false;
 writeFileSync(join(root,'story.json'),JSON.stringify(sample));
 const ctx={baseDir:root,bots:[{selfId:'b',internal}],logger:()=>({error(){}}),middleware(fn:any){middleware=fn;},command:()=>({action(){}})};
 runtime=createPluginRuntimeSync(ctx as any,{botId:'b',userId:'u',databasePath:'story.sqlite',storyConfigPath:'unused.json'},loadSettings(join(root,'story.json')));
 db=new Storage(join(root,'story.sqlite'));db.set('runtime',{...db.runtime(),paused:true});
 const message=await adapted();await middleware({isDirect:true,selfId:'b',userId:'u',platform:'onebot',messageId:'m',content:message.content},()=>{});
 await vi.waitFor(()=>expect(db!.all('image_assets')[0]?.state).toBe('ready'),{timeout:2000,interval:10});
 expect(internal.getImage).toHaveBeenCalledTimes(1);
 }finally{await runtime?.close();db?.close();vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});}
});
