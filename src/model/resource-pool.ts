import type { ModelResourcePool,ModelMessage,ModelScheduledTask,ModelOwnerView } from './context-types';
import type { WebMaterial } from '../web/types';
export const emptyResourcePool=():ModelResourcePool=>({messages:[],tasks:[],owners:[],materials:[]});
export class ResourcePool {
 readonly data:ModelResourcePool=emptyResourcePool();
 message(row:ModelMessage):string {if(!this.data.messages.some(r=>r.id===row.id))this.data.messages.push({id:row.id,direction:row.direction,content:row.content,receivedAt:row.receivedAt});return row.id;}
 task(row:ModelScheduledTask):string{if(!this.data.tasks.some(r=>r.id===row.id)){const {id,kind,at,description,checkReason,messageIds,sharedActivityId}=row;this.data.tasks.push({id,kind,at,description,...(checkReason?{checkReason}:{}),...(messageIds?{messageIds}:{}),...(sharedActivityId?{sharedActivityId}:{})});}return row.id;}
 owner(row:ModelOwnerView):string{if(!this.data.owners.some(r=>r.ref===row.ref))this.data.owners.push(structuredClone(row));return row.ref;}
 material(row:WebMaterial):string{if(!this.data.materials.some(r=>r.id===row.id))this.data.materials.push(structuredClone(row));return row.id;}
 merge(pool:ModelResourcePool):void{pool.messages.forEach(m=>this.message(m));pool.tasks.forEach(t=>this.task(t));pool.owners.forEach(o=>this.owner(o));pool.materials.forEach(m=>this.material(m));}
}

import type { CompletionRequest } from './client';
import { isStageModelInput } from './context-types';
import type { ModelCompletionEnvelope,PromptStage } from './context-types';
import { stageInput } from './context-views';
export function buildCompletionEnvelope(request:CompletionRequest):ModelCompletionEnvelope {
 const pool=new ResourcePool(),input=isStageModelInput(request.input)?request.input:null;
 if(input)pool.merge(input.resources);
 for(const m of request.webMaterials??[])pool.material(m);
 let lookupResult=request.lookupResult;
 if(lookupResult&&typeof lookupResult==='object'){
  const lookup=lookupResult as Record<string,unknown>,stage=(request.task.promptPolicy?.stage??request.task.name) as PromptStage;
  const {materials,webMaterials,...raw}=lookup;
  const materialIds:string[]=[];for(const rows of [materials,webMaterials])if(Array.isArray(rows))for(const m of rows)materialIds.push(pool.material(m as WebMaterial));
  if(['details','retrieved','shortTerm','longTerm','learned','detailHistory','history','recent','visibleMessages','reconsiderMessages','tasks','dueTasks','snapshot'].some(k=>k in raw)){
   const view=stageInput(stage,raw);pool.merge(view.resources);lookupResult={context:view.context,roles:view.roles,...(materialIds.length?{materialIds:[...new Set(materialIds)]}:{})};
  }else lookupResult={...raw,...(materialIds.length?{materialIds:[...new Set(materialIds)]}:{})};
 }
 const webResults=request.webResults?.map(result=>{const {materials,...metadata}=result;for(const m of materials)pool.material(m);return {...metadata,materialIds:[...new Set(materials.map(m=>m.id))]};});
 return {input:input?{context:input.context,roles:input.roles}:request.input,resources:pool.data,lookupResult,repair:request.repair,webResults,webStatus:request.webStatus};
}
