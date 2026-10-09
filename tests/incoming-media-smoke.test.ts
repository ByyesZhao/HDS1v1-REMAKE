import {it,expect,vi} from 'vitest';import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {apply} from '../src/index';import {Storage} from '../src/storage';
vi.mock('koishi',async()=>(await import('node:module')).createRequire(process.cwd()+'/package.json')('koishi'));
it.each([false,true])('actual plugin registers media without downloading inside input transaction; enabled=%s',async enabled=>{
 const root=mkdtempSync(join(tmpdir(),'hdsi-media-plugin-'));let middleware:any,dispose:any,downloads=0;const oldFetch=global.fetch;
 vi.stubEnv('DEEPSEEK_API_KEY','synthetic');vi.stubEnv('QWEN_API_KEY','synthetic');
 global.fetch=async()=>{downloads++;return new Response(Buffer.from('89504e470d0a1a0a00000000','hex'));};
 let db:Storage|undefined;
 try{
 const sample=JSON.parse(readFileSync('examples/story.sample.json','utf8'));sample.stickersEnabled=false;sample.visualInput={enabled};sample.initialDetails=[];writeFileSync(join(root,'story.json'),JSON.stringify(sample));
 const ctx={baseDir:root,bots:[{selfId:'b',sendPrivateMessage:async()=>[]}],logger:()=>({error(){},warn(){}}),middleware:(f:any)=>middleware=f,command:()=>({action(){}}),on:(event:string,f:any)=>{if(event==='dispose')dispose=f;}};
 apply(ctx as any,{botId:'b',userId:'u',databasePath:'story.sqlite',storyConfigPath:'story.json'});db=new Storage(join(root,'story.sqlite'));db.set('runtime',{...db.runtime(),paused:true});
 await middleware({isDirect:true,selfId:'b',userId:'u',messageId:'1',platform:'onebot',content:'甲<img src="https://offline.test/img"/>乙'},()=>{});
 expect(db.all('message_attachments')).toHaveLength(1);expect(db.messages()[0].attachmentIds).toHaveLength(1);expect(JSON.stringify(db.messages())).not.toContain('offline.test');
 await dispose();dispose=undefined;expect(downloads).toBe(enabled?1:0);
 }finally{await dispose?.();db?.close();global.fetch=oldFetch;vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});}
});
