export interface IncomingAttachment {id:string;messageId:string;order:number;kind:'image'|'market_sticker'|'native_face';sourceUrl?:string;platformFile?:string;platformAssetId?:string;faceId?:string;semanticLabel?:string}
export type MessageContentPart={kind:'text';start:number;end:number}|{kind:'attachment';attachmentId:string;start:number;end:number};
export interface ImageObservation {description:string;visibleText:string[];possibleTone:string|null;uncertain:boolean}
export interface ObservationRecord {id:string;contentHash:string|null;recognizerVersion:string;origin:PreparedAttachment['origin'];observation:ImageObservation;confirmedAt:string}
export interface AttachmentRecord extends IncomingAttachment {downloadStatus:'pending'|'ready'|'unavailable';assetRef:string|null;confirmedObservationRef:string|null;confirmedRecognizerVersion:string|null}
export interface ImageAsset {id:string;contentHash:string;mimeType:string;relativePath:string;state:'ready'|'deleting'|'deleted'}
export interface PreparedAttachment {messageId:string;attachmentId:string;order:number;status:'ready'|'unrecognized';origin:'platform'|'library'|'cache'|'vision'|'unavailable';observationRef:string|null;recognizerVersion:string|null;observation:ImageObservation|null}
export type FrozenAttachment={messageId:string;attachmentId:string;order:number;status:'pending';imageAssetRef:string|null;phaseKey:string;recognizerVersion:string}|Omit<PreparedAttachment,'observation'>;
export interface TurnVisualContext {version:1;entries:FrozenAttachment[]}
