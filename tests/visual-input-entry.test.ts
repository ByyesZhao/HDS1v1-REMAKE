import {expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {apply} from '../src/index';
import {Storage} from '../src/storage';
import {makeSharedFixture} from './shared-v3-fixture';
vi.mock('koishi',async()=>(await import('node:module')).createRequire(`${process.cwd()}/package.json`)('koishi'));

it.each([false,true])('real middleware persists visual inputs and redelivery identity; shared=%s',async shared=>{
 const root=mkdtempSync(join(tmpdir(),'hdsi-visual-input-'));let middleware:any,dispose:any,db:Storage|undefined;
 vi.stubEnv('DEEPSEEK_API_KEY','synthetic');vi.stubEnv('QWEN_API_KEY','synthetic');
 try{
  const sample=JSON.parse(readFileSync('examples/story.sample.json','utf8'));sample.stickersEnabled=false;writeFileSync(join(root,'story.json'),JSON.stringify(sample));
  const ctx={baseDir:root,bots:[{selfId:'b',sendPrivateMessage:async()=>[]}],logger:()=>({error(){}}),middleware:(fn:any)=>{middleware=fn;},command:()=>({action(){}}),on:(event:string,fn:any)=>{if(event==='dispose')dispose=fn;}};
  apply(ctx as any,{botId:'b',userId:'u',databasePath:'isolated.sqlite',storyConfigPath:'story.json'});
  db=new Storage(join(root,'isolated.sqlite'));db.set('runtime',{...db.runtime(),paused:true});if(shared)makeSharedFixture({storage:db} as any);
  const session={isDirect:true,selfId:'b',userId:'u',platform:'onebot'};
  const contents=['<img src="https://offline.test/private.png"/>','<face id="14"/>','<mface key="opaque"/>','刚刚只是开玩笑<img src="https://offline.test/other.png"/>','我说表情包这个词','【推进】<img src="https://offline.test/a.png"/>'];
  for(const [i,content] of contents.entries())await middleware({...session,messageId:String(i),content},()=>{});
  const rows=db.messages();expect(rows).toHaveLength(6);
  expect(rows.map(m=>!!(m as any).hasVisualAttachment)).toEqual([true,true,true,true,false,true]);
  expect(rows[3].content).toContain('刚刚只是开玩笑');expect(rows[4].content).toBe('我说表情包这个词');
  expect(JSON.stringify(rows)).not.toContain('offline.test');expect(JSON.stringify(rows)).not.toContain('opaque');
  expect(new Set(rows.map(m=>m.batchId)).size).toBe(1);expect(db.all('control_requests')).toHaveLength(0);
  if(shared)expect(rows.every(m=>m.sharedActivityId===db!.character().scene.shared!.activityId)).toBe(true);
  await middleware({...session,messageId:'0',content:contents[0]},()=>{});expect(db.messages()).toHaveLength(6);
  await middleware({...session,messageId:'ignored',content:'<audio src="https://offline.test/a.mp3"/>'},()=>{});expect(db.messages()).toHaveLength(6);
 }finally{
  db?.close();await dispose?.();vi.unstubAllEnvs();const rel=relative(tmpdir(),root);if(!rel.startsWith('..')&&!rel.includes(':'))rmSync(root,{recursive:true,force:true});
 }
});
