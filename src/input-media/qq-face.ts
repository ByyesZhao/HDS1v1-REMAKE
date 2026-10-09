import * as qface from 'qface';
import type {ImageObservation} from './types';
export const PLATFORM_FACE_VERSION='qq-face:qface-1.4.1';
export function faceObservation(id:string|undefined):ImageObservation|null{
 const name=id?qface.get(id)?.QDes?.replace(/^\//,'').trim():null;
 return name?{description:'QQ 原生表情：'+name+'（ID: '+id+'）',visibleText:[],possibleTone:null,uncertain:false}:null;
}
