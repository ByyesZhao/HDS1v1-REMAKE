import {it,expect,vi} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {fixture,long,at} from './memory-capacity-fixture';
import {consolidationTask} from '../src/model/contracts';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {Storage} from '../src/storage';import {apply} from '../src/index';
import {makeSharedFixture} from './shared-v3-fixture';
vi.mock('koishi',async()=>(await import('node:module')).createRequire(`${process.cwd()}/package.json`)('koishi'));
it('duplicate short IDs cannot satisfy the merge contract',()=>{
 const d=fixture(),l=long(d.store,'l'),s=d.store.makeOwner({ownerType:'short',ownerId:'s'},{content:'详细经历',sourceIds:['e'],linkedLongId:l.id},at);
 expect(()=>consolidationTask([s,l],['s']).parse({units:[{unitKey:'m',action:'merge_short',ids:['s','s'],readOwners:['s','l'],canonicalShortId:'s',content:'详情',eventSummary:'摘要',feelingSummary:'',sourceIds:['e']}]})).toThrow(/distinct|duplicate/);
});
it('direct merge cannot mutate a single short through duplicate IDs',()=>{
 const d=fixture(),l=long(d.store,'l'),s=d.store.makeOwner({ownerType:'short',ownerId:'s'},{content:'原始详情',sourceIds:['e'],linkedLongId:l.id},at);d.store.saveOwner(s);
 expect(()=>new MemoryLifecycle(d.store).mergeShort(['s','s'],'s','改写','摘要','',['e'],at)).toThrow();expect(d.store.owner(s)?.content).toBe('原始详情');
});
it.each([['你好',false],['【推进】',false],['你好',true],['【推进】',true]] as const)('production middleware ignores platform redelivery: %s shared=%s',async(content,shared)=>{
 const root=mkdtempSync(join(tmpdir(),'hdsi-review17-entry-'));let middleware:any,dispose:any,db:Storage|undefined;
 vi.stubEnv('DEEPSEEK_API_KEY','synthetic');vi.stubEnv('QWEN_API_KEY','synthetic');
 try{
  const sample=JSON.parse(readFileSync('examples/story.sample.json','utf8'));sample.stickersEnabled=false;writeFileSync(join(root,'story.json'),JSON.stringify(sample));
  const ctx={baseDir:root,bots:[{selfId:'b',sendPrivateMessage:async()=>[]}],logger:()=>({error(){}}),middleware:(fn:any)=>{middleware=fn;},command:()=>({action(){}}),on:(event:string,fn:any)=>{if(event==='dispose')dispose=fn;}};
  apply(ctx as any,{botId:'b',userId:'u',databasePath:'isolated.sqlite',storyConfigPath:'story.json'});
  const session={isDirect:true,selfId:'b',userId:'u',platform:'onebot',messageId:'123',content};
  db=new Storage(join(root,'isolated.sqlite'));db.set('runtime',{...db.runtime(),paused:true});if(shared)makeSharedFixture({storage:db} as any);await middleware(session,()=>{});const before=db.runtime(),beforeCharacter=db.character();
  await new Promise(r=>setTimeout(r,5));await middleware(session,()=>{});
  expect(db.all(content==='【推进】'?'control_requests':'messages')).toHaveLength(1);expect(db.runtime()).toEqual(before);expect(db.character()).toEqual(beforeCharacter);
  if(content==='你好'){await middleware({...session,messageId:undefined},()=>{});await middleware({...session,messageId:undefined},()=>{});expect(db.all('messages')).toHaveLength(3);}
 }finally{db?.close();await dispose?.();vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});}
});
