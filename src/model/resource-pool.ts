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
