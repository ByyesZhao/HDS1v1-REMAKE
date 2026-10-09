import {h} from 'koishi';
import type {IncomingAttachment,MessageContentPart} from './types';
export function parseIncomingContent(messageId:string,rawContent:string) {
 let content='';const attachments:IncomingAttachment[]=[],contentParts:MessageContentPart[]=[];
 function text(value:string){if(!value)return;const start=content.length;content+=value;contentParts.push({kind:'text',start,end:content.length});}
 function walk(elements:ReturnType<typeof h.parse>){for(const e of elements){
  if(e.type==='text'){text(String(e.attrs.content??''));continue;}
  const kind=e.type==='img'||e.type==='image'?'image':e.type==='face'?'native_face':e.type==='mface'?'market_sticker':null;
  if(!kind)continue;
  const order=attachments.length,id=JSON.stringify([messageId,order]),attrs=e.attrs;
  const a:IncomingAttachment={id,messageId,order,kind};
  if(typeof attrs.src==='string'||typeof attrs.url==='string')a.sourceUrl=attrs.src??attrs.url;
  if(typeof attrs.file==='string')a.platformFile=attrs.file;
  if(kind==='native_face'&&attrs.id!==undefined)a.faceId=String(attrs.id);
  if(kind==='market_sticker'&&attrs.key!==undefined)a.platformAssetId=String(attrs.key);
  if(typeof attrs.name==='string')a.semanticLabel=attrs.name;
  attachments.push(a);
  const start=content.length;content+=kind==='image'?'（用户发送图片，未识别内容）':kind==='native_face'?'（用户发送表情，未识别内容）':'（用户发送表情包，未识别内容）';
  contentParts.push({kind:'attachment',attachmentId:id,start,end:content.length});
 }}
 walk(h.parse(rawContent));return {content,contentParts,attachments,hasVisualAttachment:attachments.length>0};
}
