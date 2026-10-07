import { Storage } from '../storage';
import type { RetrievalRequest } from './types';
import { MemoryStore } from './store';
import { MemoryRetrieval, makeRetrievalRequest } from './retrieval';
export { queryTerms } from './lexical';
export class ContextBuilder {
  readonly retrieval:MemoryRetrieval;
  constructor(storage:Storage,retrieval?:MemoryRetrieval){this.retrieval=retrieval??new MemoryRetrieval(new MemoryStore(storage));}
  async build(request:RetrievalRequest) {
    return this.retrieval.budget(await this.retrieval.build(request),request.budget??this.retrieval.limits.historyBudget,request.permissions.visibleSourceIds);
  }
  async buildForMemory(request:RetrievalRequest) {
    const context=await this.retrieval.build(request);
    return this.retrieval.budget({details:context.details,retrieved:[...context.shortTerm,...context.longTerm,...context.learned]},request.budget??this.retrieval.limits.historyBudget,request.permissions.visibleSourceIds);
  }
  async lookupDetails(query:string){const r=await this.build(makeRetrievalRequest(query,new Date().toISOString(),'legacy_lookup'));return {details:r.details,detailHistory:r.detailHistory};}
}
