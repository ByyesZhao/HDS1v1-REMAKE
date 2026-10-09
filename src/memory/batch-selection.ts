export interface MaintenanceBatchLimits {batchItems:number;batchCharacters:number|null}
export function selectMaintenanceBatch<T extends {content:string}>(orderedRows:readonly T[],limits:MaintenanceBatchLimits):T[]{
 const selected:T[]=[];let characters=0;
 for(const row of orderedRows){
  if(selected.length>=limits.batchItems)break;
  const size=[...row.content].length;
  if(selected.length&&limits.batchCharacters!==null&&characters+size>limits.batchCharacters)break;
  selected.push(row);characters+=size;
 }
 return selected;
}
