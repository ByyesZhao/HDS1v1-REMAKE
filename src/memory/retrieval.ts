import { countVisibleCharacters } from '../output/qq';
import type { ContextLimits, LookupRequest, MemoryCandidate, RetrievedContext, RetrievalRequest } from './types';
import { defaultContextLimits,memoryOwnerData } from './types';
import { MemoryStore } from './store';
import { MemoryIndex } from './index';
import { lexicalCoverage } from './lexical';
export { queryTerms } from './lexical';
export interface RetrievalCalibration {
  lexical:{fact:number;experience:number}; semantic?:{fact:number;experience:number;configSignature:string}|null;
}
export const defaultCalibration:RetrievalCalibration={lexical:{fact:1,experience:1},semantic:null};
const wantsArchive=(q:string)=>/还记得|回忆|那次|去年.*(?:生日|经历|考试)/.test(q);
const wantsHistory=(q:string)=>/以前|之前|旧|曾经|变化|原来|过去/.test(q);
export function makeRetrievalRequest(query:string,at:string,phase:string,budget:number|null=null,visibleSourceIds:string[]=[]):RetrievalRequest {
  const currentOnly=phase==='world'||phase==='school'||phase.startsWith('school_');
  const allowArchive=!currentOnly&&wantsArchive(query),allowDetailHistory=!currentOnly&&wantsHistory(query);
  return {query,at,phase,budget,scope:allowArchive?'archive':'current',includeDetailHistory:allowDetailHistory,permissions:{allowArchive,allowDetailHistory,visibleSourceIds}};
}
const key=(row:MemoryCandidate)=>`${row.ownerType}:${row.ownerId}`;
const publicRow=memoryOwnerData;
export class MemoryRetrieval {
  readonly limits:ContextLimits;
  metrics={candidates:0,selected:0,excludedByLimits:0,sqlMs:0};
  constructor(public readonly store:MemoryStore,private index?:MemoryIndex,limits:Partial<ContextLimits>={},private calibration:RetrievalCalibration=defaultCalibration){this.limits={...defaultContextLimits,...limits};}
  async build(request:RetrievalRequest):Promise<RetrievedContext> {
    const at=performance.now(),candidates=this.store.selectCandidates(request);this.metrics.sqlMs=performance.now()-at;this.metrics.candidates=candidates.length;
    const vector=this.index?await this.index.query(request.query):null;
    if(this.index&&!vector)this.index.stats.lexicalFallbacks++;
    const lexical:Array<{row:MemoryCandidate;score:number}>=[],semantic:Array<{row:MemoryCandidate;score:number}>=[],direct:MemoryCandidate[]=[];
    const always=candidates.filter(r=>r.ownerType==='learned'&&r.alwaysInclude);
    for(const row of candidates.filter(r=>!always.includes(r))) {
      const facts=row.ownerType==='detail';
      if(facts&&[row.key,...row.aliases??[]].filter(Boolean).some(alias=>request.query.toLowerCase().includes(alias!.toLowerCase()))) {direct.push(row);continue;}
      const score=lexicalCoverage(request.query,`${row.content} ${row.topics.join(' ')} ${row.feelingSummary} ${row.key??''} ${row.aliases?.join(' ')??''}`);
      if(score>0&&score>=this.calibration.lexical[facts?'fact':'experience'])lexical.push({row,score});
      const threshold=this.calibration.semantic;
      if(vector&&row.normalizedVector&&threshold&&threshold.configSignature===this.index?.configSignature&&vector.length===row.normalizedVector.length){
        const similarity=vector.reduce((sum,value,i)=>sum+value*row.normalizedVector![i],0);
        if(similarity>=threshold[facts?'fact':'experience'])semantic.push({row,score:similarity});
      }
    }
    const tie=(a:{row:MemoryCandidate;score:number},b:{row:MemoryCandidate;score:number})=>b.score-a.score||(b.row.importance==='high'?1:0)-(a.row.importance==='high'?1:0)||a.row.id.localeCompare(b.row.id);
    lexical.sort(tie);semantic.sort(tie);
    const routeLimit=this.limits.candidateItemsPerRoute;
    const routes=[routeLimit===null?lexical:lexical.slice(0,routeLimit),routeLimit===null?semantic:semantic.slice(0,routeLimit)];
    const fused=new Map<string,{row:MemoryCandidate;score:number}>();
    for(const route of routes)route.forEach(({row},rank)=>{const id=key(row),existing=fused.get(id);fused.set(id,{row,score:(existing?.score??0)+1/(60+rank+1)});});
    const ranked=[...direct.sort((a,b)=>a.id.localeCompare(b.id)),...[...fused.values()].sort(tie).map(r=>r.row)];
    const cap=(rows:MemoryCandidate[],limit:number|null)=>limit===null?rows:rows.slice(0,limit);
    const stable=[...always].sort((a,b)=>a.id.localeCompare(b.id));
    if(this.limits.alwaysIncludeCharactersLimit!==null)while(stable.length&&countVisibleCharacters(JSON.stringify(stable))>this.limits.alwaysIncludeCharactersLimit)stable.pop();
    const long=cap(ranked.filter(r=>r.ownerType==='long'||r.ownerType==='learned'),this.limits.longItemsLimit);
    const details=cap(ranked.filter(r=>r.ownerType==='detail'),this.limits.detailItemsLimit);
    const detailKeys=new Set(details.map(r=>r.key));
    const result:RetrievedContext={recent:this.store.storage.messages().filter(m=>m.direction==='outgoing'||m.seenTurnId!==null).slice(-this.limits.recentMessagesLimit),
      details:details.map(publicRow),shortTerm:cap(ranked.filter(r=>r.ownerType==='short'),this.limits.shortItemsLimit).map(publicRow),
      longTerm:long.filter(r=>r.ownerType==='long').map(publicRow),learned:[...long.filter(r=>r.ownerType==='learned'),...stable].map(publicRow),
      detailHistory:request.includeDetailHistory?this.store.storage.all('detail_history').filter(h=>detailKeys.has(h.key)):[]};
    this.metrics.selected=result.details.length+result.shortTerm.length+result.longTerm.length+result.learned.length;
    this.metrics.excludedByLimits=ranked.length+always.length-this.metrics.selected;
    return result;
  }
  async lookup(request:LookupRequest,base:RetrievalRequest):Promise<RetrievedContext> {
    const wanted=typeof request==='string'?{query:request,scope:wantsArchive(request)?'archive' as const:'current' as const,includeDetailHistory:wantsHistory(request)}:request;
    if(wanted.scope==='archive'&&!base.permissions.allowArchive||wanted.includeDetailHistory&&!base.permissions.allowDetailHistory)throw new Error('retrieval permission denied');
    return this.budget(await this.build({...base,...wanted}),base.budget??this.limits.historyBudget,base.permissions.visibleSourceIds);
  }
  budget<T extends object>(result:T,budget:number|null,protectedIds:string[]=[]):T {
    if(budget===null)return result;
    const r=result as Record<string,unknown>;
    for(const field of ['retrieved','longTerm','shortTerm','learned','detailHistory','details','recent']) {
      const array=r[field];if(!Array.isArray(array))continue;
      const protectedRow=(row:any)=>protectedIds.includes(row.id)||row.sourceIds?.some((id:string)=>protectedIds.includes(id));
      while(countVisibleCharacters(JSON.stringify(result))>budget){let i=array.length-1;while(i>=0&&protectedRow(array[i]))i--;if(i<0)break;array.splice(i,1);this.metrics.excludedByLimits++;}
    }
    return result;
  }
}
