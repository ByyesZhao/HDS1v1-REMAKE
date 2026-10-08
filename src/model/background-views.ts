import {z} from 'zod';
import type {AppConfig} from '../config';
import type {PromptStage} from './context-types';
export const backgroundViewsSchema=z.object({version:z.literal(1),status:z.enum(['candidate_pending_review','approved']),core:z.string(),style:z.string(),world:z.string(),campus:z.string(),group:z.string(),facts:z.array(z.object({key:z.string(),value:z.string(),aliases:z.array(z.string()),source:z.object({paragraph:z.number().int().nonnegative(),original:z.string()})})),sourceMap:z.array(z.object({paragraph:z.number().int().nonnegative(),uses:z.array(z.enum(['core','style','world','campus','group'])),original:z.string(),text:z.string()}))});
export type BackgroundViews=z.infer<typeof backgroundViewsSchema>;
export function backgroundFor(config:Pick<AppConfig,'background'|'backgroundViews'>,stage:PromptStage):string {
 const views=config.backgroundViews;if(views?.status!=='approved')return config.background;
 return stage==='world'?views.world:stage==='school_campus'?views.campus:stage==='school_group'?views.group:views.core;
}
export function initializeMissingBackgroundFacts(store:import('../memory/store').MemoryStore,views:BackgroundViews|undefined,at:string):number {
 if(views?.status!=='approved')return 0;let count=0;
 for(const fact of views.facts){if(store.owner({ownerType:'detail',ownerId:fact.key}))continue;store.saveOwner(store.makeOwner({ownerType:'detail',ownerId:fact.key},{key:fact.key,value:fact.value,content:fact.value,aliases:fact.aliases,effectiveAt:at},at));count++;}
 return count;
}
