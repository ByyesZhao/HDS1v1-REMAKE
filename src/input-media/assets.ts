import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import type {IncomingAttachment} from './types';
import {IncomingMediaStore} from './store';
export class ImageUnavailableError extends Error {constructor(message='image source unavailable'){super(message);}}
export function imageMime(bytes:Uint8Array):string {
 const b=Buffer.from(bytes);if(b.subarray(0,8).toString('hex')==='89504e470d0a1a0a')return 'image/png';
 if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
 if(/^GIF8[79]a/.test(b.subarray(0,6).toString()))return 'image/gif';
 if(b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP')return 'image/webp';
 throw new ImageUnavailableError('unsupported image bytes');
}
export class AttachmentResolver {
 constructor(private fetcher:typeof fetch=fetch,private getImage?:(file:string)=>Promise<{url?:string;base64?:string}>) {}
 async resolve(a:IncomingAttachment,signal?:AbortSignal):Promise<{bytes:Uint8Array;mimeType:string}> {
  signal?.throwIfAborted();let url=a.sourceUrl;
  if((!url||!/^https?:\/\//.test(url)&&!/^data:image\/[^;,]+;base64,/.test(url))&&a.platformFile&&this.getImage){
   try {const data=await this.getImage(a.platformFile);signal?.throwIfAborted();url=data.url??(data.base64?'data:image/unknown;base64,'+data.base64:undefined);}
   catch {signal?.throwIfAborted();throw new ImageUnavailableError('platform image source unavailable');}
  }
  if(!url)throw new ImageUnavailableError();
  let bytes:Buffer;
  if(/^data:image\/[^;,]+;base64,/.test(url))bytes=Buffer.from(url.slice(url.indexOf(',')+1),'base64');
  else if(/^https?:\/\//.test(url)){try{const response=await this.fetcher(url,{signal});if(!response.ok)throw new ImageUnavailableError('image HTTP '+response.status);bytes=Buffer.from(await response.arrayBuffer());}catch(e){if(signal?.aborted)throw e;if(e instanceof ImageUnavailableError)throw e;throw new ImageUnavailableError();}}
  else throw new ImageUnavailableError();
  signal?.throwIfAborted();return {bytes,mimeType:imageMime(bytes)};
 }
}
export class IncomingAssets {
 private jobs=new Map<string,Promise<string>>();private saves=new Map<string,Promise<void>>();
 private controllers=new Set<AbortController>();private uses=new Map<string,number>();private deleting=new Map<string,Promise<void>>();
 private stopped=false;
 constructor(readonly store:IncomingMediaStore,readonly root:string,private resolver:AttachmentResolver) {}
 async ensureAsset(id:string,signal?:AbortSignal):Promise<string> {
  if(this.stopped)throw Error('incoming media stopped');signal?.throwIfAborted();
  const a=this.store.storage.read('message_attachments',id);if(!a)throw Error('missing attachment');
  if(a.assetRef){const asset=this.store.storage.read('image_assets',a.assetRef);if(asset?.state==='ready'){await readFile(join(this.root,asset.relativePath));return asset.id;}if(asset?.state==='deleting')await this.deleting.get(asset.id);}
  const existing=this.jobs.get(id);if(existing)return existing;
  const controller=new AbortController();this.controllers.add(controller);
  const onAbort=()=>controller.abort(signal?.reason);signal?.addEventListener('abort',onAbort,{once:true});
  const job=(async()=>{const {bytes,mimeType}=await this.resolver.resolve(a,controller.signal);controller.signal.throwIfAborted();
   const hash=createHash('sha256').update(bytes).digest('hex'),ext=({'image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp'} as Record<string,string>)[mimeType],relativePath=hash+'.'+ext;
   const del=this.deleting.get(hash);if(del)await del;
   let save=this.saves.get(hash);if(!save){save=(async()=>{const old=this.store.storage.read('image_assets',hash);if(old?.state==='ready')return;
    await mkdir(this.root,{recursive:true});const temp=join(this.root,relativePath+'.'+randomUUID()+'.tmp');
    try{await writeFile(temp,bytes);controller.signal.throwIfAborted();await rename(temp,join(this.root,relativePath));this.store.storage.save('image_assets',hash,{id:hash,contentHash:hash,mimeType,relativePath,state:'ready'});}finally{await unlink(temp).catch(()=>{});}
   })();this.saves.set(hash,save);save.finally(()=>this.saves.delete(hash)).catch(()=>{});}await save;controller.signal.throwIfAborted();
   const current=this.store.storage.read('message_attachments',id)!;const {sourceUrl,...rest}=current;
   this.store.storage.save('message_attachments',id,{...rest,downloadStatus:'ready',assetRef:hash});return hash;
  })().finally(()=>{this.jobs.delete(id);this.controllers.delete(controller);signal?.removeEventListener('abort',onAbort);});
  this.jobs.set(id,job);return job;
 }
 async resolveImageAsset(ref:string):Promise<string>{
  if(this.deleting.has(ref))await this.deleting.get(ref);
  const asset=this.store.storage.read('image_assets',ref);if(!asset||asset.state!=='ready')throw Error('pending image asset missing: '+ref);
  this.uses.set(ref,(this.uses.get(ref)??0)+1);
  try{const bytes=await readFile(join(this.root,asset.relativePath));return 'data:'+asset.mimeType+';base64,'+bytes.toString('base64');}finally{this.uses.set(ref,this.uses.get(ref)!-1);}
 }
 async retire(ref:string,eligible:()=>boolean):Promise<boolean> {
  const asset=this.store.storage.read('image_assets',ref);if(!asset||!['ready','deleting'].includes(asset.state)||this.uses.get(ref)||this.jobs.size||!eligible())return false;
  let removed=false;const work=(async()=>{await Promise.resolve();if(!eligible()||this.uses.get(ref))return;
   this.store.storage.save('image_assets',ref,{...asset,state:'deleting'});
   await unlink(join(this.root,asset.relativePath)).catch(e=>{if(e.code!=='ENOENT')throw e;});
   this.store.storage.save('image_assets',ref,{...asset,state:'deleted'});removed=true;
  })();this.deleting.set(ref,work);try{await work;return removed;}finally{this.deleting.delete(ref);}
 }
 async stop(options:{graceful?:boolean}={}){this.stopped=true;if(!options.graceful)for(const c of this.controllers)c.abort();await Promise.allSettled([...this.jobs.values(),...this.saves.values(),...this.deleting.values()]);}
}
