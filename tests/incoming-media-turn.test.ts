import {it,expect} from 'vitest';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {Storage} from '../src/storage';import {IncomingMediaStore} from '../src/input-media/store';import {IncomingAssets,AttachmentResolver} from '../src/input-media/assets';import {IncomingMediaService} from '../src/input-media/service';
import {INCOMING_IMAGE_RECOGNIZER_VERSION as V} from '../src/input-media/observe';
const data='data:image/png;base64,iVBORw0KGgoAAAAA';
it('freezes unknown and ready per attachment and reopens pending on the same disk image',async()=>{
 const root=mkdtempSync(join(tmpdir(),'hdsi-img-turn-')),path=join(root,'story.sqlite');let db=new Storage(path),calls=0,fail=true;
 const runner={async runModel(){calls++;if(fail)throw Error('synthetic model fail');return {description:'猫',visibleText:[],possibleTone:null,uncertain:false} as any;}};
 const make=(enabled=true)=>{const store=new IncomingMediaStore(db),assets=new IncomingAssets(store,join(root,'incoming-media'),new AttachmentResolver());return {store,assets,service:new IncomingMediaService(store,assets,runner,{enabled})};};
 try{
 let x=make();x.store.register([{id:'a',messageId:'z',order:0,kind:'image'},{id:'b',messageId:'z',order:1,kind:'image',sourceUrl:data}]);db.save('turns','t',{id:'t',visualContext:{version:1,entries:[]}} as any);
 await expect(x.service.prepareForTurn('t',['z'])).rejects.toThrow('synthetic');expect(db.read('turns','t')!.visualContext!.entries.map(e=>e.status)).toEqual(['unrecognized','pending']);
 const ref=(db.read('turns','t')!.visualContext!.entries[1] as any).imageAssetRef;expect(ref).toBeTruthy();
 await x.service.stop();db.close();db=new Storage(path);x=make(false);fail=false;
 db.save('message_attachments','a',{...db.read('message_attachments','a')!,sourceUrl:data});
 db.save('message_attachments','b',{...db.read('message_attachments','b')!,sourceUrl:'https://invalid.test/changed'});
 const result=await x.service.prepareForTurn('t',['z']);expect(result.map(r=>r.status)).toEqual(['unrecognized','ready']);
 expect(calls).toBe(2);expect((db.read('turns','t')!.visualContext!.entries[1] as any).observationRef).toBeTruthy();
 const again=await x.service.prepareForTurn('t',['z']);expect(again).toEqual(result);expect(calls).toBe(2);
 expect(x.service.readConfirmedForMessages(['z'])).toHaveLength(1);await x.service.stop();
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
