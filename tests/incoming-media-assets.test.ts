import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Storage} from '../src/storage';import {IncomingMediaStore} from '../src/input-media/store';
import {IncomingAssets,AttachmentResolver} from '../src/input-media/assets';
const png=Buffer.from('89504e470d0a1a0a00000000','hex');
it('deduplicates actual bytes, stores reopenable data URLs and excludes legacy mixed descriptions',async()=>{
 const root=mkdtempSync(join(tmpdir(),'hdsi-img-')),db=new Storage(':memory:'),store=new IncomingMediaStore(db);
 try{
 store.register(['a','b','c'].map((id,i)=>({id,messageId:'m',order:i,kind:'image',sourceUrl:i===2?'https://t.test/other':'data:image/png;base64,'+png.toString('base64')})));
 const resolver=new AttachmentResolver(async()=>new Response(Buffer.concat([png,Buffer.from('other')])));
 const assets=new IncomingAssets(store,root,resolver);
 const [a,b]=await Promise.all([assets.ensureAsset('a'),assets.ensureAsset('b')]);
 expect(a).toBe(b);expect(await assets.resolveImageAsset(a)).toContain('data:image/png;base64,');
 expect(await assets.ensureAsset('c')).not.toBe(a);
 expect(store.findLibraryObservation(a)).toBeNull();expect(db.read('message_attachments','a')!.sourceUrl).toBeUndefined();
 await assets.stop();
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
it('missing or arbitrary filesystem sources are explicitly unavailable',async()=>{
 const resolver=new AttachmentResolver();await expect(resolver.resolve({id:'a',messageId:'m',order:0,kind:'image',sourceUrl:'D:/secret.txt'})).rejects.toThrow('unavailable');
});
