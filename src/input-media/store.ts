import {Storage} from '../storage';
import type {AttachmentRecord,IncomingAttachment,ObservationRecord} from './types';
export class IncomingMediaStore {
 constructor(readonly storage:Storage){}
 readonlyCheck():void{if(!this.storage.hasTable('message_attachments'))return;for(const r of this.storage.prepare("SELECT data FROM message_attachments WHERE json_extract(data,'$.confirmedObservationRef') IS NOT NULL").iterate()){const a=JSON.parse(String(r.data)) as AttachmentRecord;const observation=this.storage.read('image_observations',a.confirmedObservationRef!);if(!observation||observation.recognizerVersion!==a.confirmedRecognizerVersion)throw Error('confirmed image observation integrity error: '+a.id);}}
 register(attachments:readonly IncomingAttachment[]):void {for(const a of attachments)if(!this.storage.read('message_attachments',a.id))this.storage.save('message_attachments',a.id,{...a,downloadStatus:'pending',assetRef:null,confirmedObservationRef:null,confirmedRecognizerVersion:null});}
 forMessages(ids:readonly string[]):AttachmentRecord[]{if(!ids.length||!this.storage.hasTable('message_attachments'))return [];return this.storage.prepare("SELECT a.data FROM json_each(?) requested JOIN message_attachments a ON json_extract(a.data,'$.messageId')=requested.value ORDER BY CAST(requested.key AS INTEGER),json_extract(a.data,'$.order')").all(JSON.stringify(ids)).map(r=>JSON.parse(String(r.data)));}
 findObservation(hash:string,version:string):ObservationRecord|null{if(!this.storage.hasTable('image_observations'))return null;const r=this.storage.prepare("SELECT data FROM image_observations WHERE json_extract(data,'$.contentHash')=? AND json_extract(data,'$.recognizerVersion')=? LIMIT 1").get(hash,version);return r?JSON.parse(String(r.data)):null;}
 findLibraryObservation(_hash:string):ObservationRecord|null{return null;}
 saveObservation(row:ObservationRecord):void {const old=this.storage.read('image_observations',row.id);if(old&&JSON.stringify(old)!==JSON.stringify(row))throw Error('immutable image observation conflict');if(!old)this.storage.save('image_observations',row.id,row);}
}
