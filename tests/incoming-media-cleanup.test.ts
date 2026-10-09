import {it,expect} from 'vitest';import {mkdtempSync,rmSync,existsSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {Storage} from '../src/storage';import {IncomingMediaStore} from '../src/input-media/store';import {IncomingAssets,AttachmentResolver} from '../src/input-media/assets';import {IncomingMediaService} from '../src/input-media/service';
it('protects unread same-hash references and preserves observations after asset retirement',async()=>{
 const root=mkdtempSync(join(tmpdir(),'hdsi-clean-img-')),db=new Storage(':memory:'),store=new IncomingMediaStore(db),assets=new IncomingAssets(store,root,new AttachmentResolver()),media=new IncomingMediaService(store,assets,{runModel:async()=>({description:'图',visibleText:[],possibleTone:null,uncertain:false} as any)},{enabled:true});
 try{store.register([{id:'a',messageId:'m',order:0,kind:'image',sourceUrl:'data:image/png;base64,iVBORw0KGgoAAAAA'}]);db.save('messages','m',{id:'m',content:'图',direction:'incoming',receivedAt:'2026-10-09T10:00:00Z',seenTurnId:null} as any);db.save('turns','t',{id:'t',done:false,inputMessageIds:['m']} as any);
 await media.prepareForTurn('t',['m']);const a=db.read('message_attachments','a')!,path=join(root,db.read('image_assets',a.assetRef!)!.relativePath);
 expect(await media.cleanupOne('2026-10-10T00:00:00Z')).toBe('none');expect(existsSync(path)).toBe(true);
 db.save('messages','m',{...db.read('messages','m')!,seenTurnId:'t'});db.save('turns','t',{...db.read('turns','t')!,done:true});
 expect(await media.cleanupOne('2026-10-10T00:00:00Z')).toBe('applied');expect(existsSync(path)).toBe(false);expect(media.readConfirmedForMessages(['m'])[0].observation!.description).toBe('图');
 await media.stop();await expect(assets.ensureAsset('a')).rejects.toThrow('stopped');
 }finally{await media.stop();db.close();rmSync(root,{recursive:true,force:true});}
});
it('rechecks references after an asynchronous deletion boundary',async()=>{
 const root=mkdtempSync(join(tmpdir(),'hdsi-clean-race-')),db=new Storage(':memory:'),store=new IncomingMediaStore(db),assets=new IncomingAssets(store,root,new AttachmentResolver());let eligible=true;
 try{store.register([{id:'a',messageId:'m',order:0,kind:'image',sourceUrl:'data:image/png;base64,iVBORw0KGgoAAAAA'}]);const ref=await assets.ensureAsset('a');const pending=assets.retire(ref,()=>eligible);eligible=false;expect(await pending).toBe(false);expect(await assets.resolveImageAsset(ref)).toContain('data:image');}finally{await assets.stop();db.close();rmSync(root,{recursive:true,force:true});}
});
