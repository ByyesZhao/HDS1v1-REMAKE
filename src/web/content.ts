import { z } from 'zod';
import type { WebMaterial,WebOperationRequest } from './types';
export function normalizeWebUrl(url:string):string {
  const parsed=new URL(url);if(!['http:','https:'].includes(parsed.protocol))throw new Error('web URL must use HTTP or HTTPS');parsed.hash='';return parsed.href;
}
export const webSearchToolSchema=z.object({webSearch:z.object({query:z.string().trim().min(1),requestedPages:z.number().int().positive().default(1)})});
export const webReadToolSchema=z.object({webRead:z.object({url:z.string().url().refine(url=>/^https?:\/\//i.test(url))})});
export function parseWebTool(value:unknown):WebOperationRequest|null {
  if(value&&typeof value==='object'&&'webSearch' in value){const parsed=webSearchToolSchema.parse(value);return {kind:'search',request:parsed.webSearch};}
  if(value&&typeof value==='object'&&'webRead' in value){const parsed=webReadToolSchema.parse(value);return {kind:'read',url:normalizeWebUrl(parsed.webRead.url)};}
  return null;
}
export function normalizeMaterial(input:{id:string;url:string;title:string;body:string;readAt:string;selectionMode:'full_body'|'relevant_passages'}):WebMaterial {
  const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '};
  const body=input.body.replace(/<(script|style|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi,'')
    .replace(/<!--[^]*?-->/g,'').replace(/<\/(p|div|section|article|main|li|h[1-6])\s*>|<br\s*\/?\s*>/gi,'\n')
    .replace(/<[^>]+>/g,'').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,entity:string)=>entity[0]==='#'?String.fromCodePoint(parseInt(entity.slice(entity[1]?.toLowerCase()==='x'?2:1),entity[1]?.toLowerCase()==='x'?16:10)):entities[entity.toLowerCase()])
    .replace(/[\t \r]+/g,' ').replace(/\n\s*\n+/g,'\n\n').trim();
  if(!body)throw new Error('empty body');
  return {...input,url:normalizeWebUrl(input.url),body,bodyCharacters:[...body].length,sourceKind:'external_reference'};
}
