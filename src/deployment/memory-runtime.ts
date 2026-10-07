import { readFileSync } from 'node:fs';
import type { Clock,ModelRunner } from '../types';
import type { StorySettings } from '../settings';
import { HttpEmbeddingProvider } from '../embedding';
import { Storage } from '../storage';
import { MemoryStore } from '../memory/store';
import { MemoryLifecycle } from '../memory/lifecycle';
import { MemoryIndex } from '../memory/index';
import { MemoryRetrieval,defaultCalibration,RetrievalCalibration } from '../memory/retrieval';
import { MemoryMaintenance } from '../memory/maintenance';
export function assembleMemory(storage:Storage,settings:StorySettings,models:ModelRunner,clock:Clock,onReady:()=>void,environment=process.env,store=new MemoryStore(storage),web?:import('../web/service').WebSearchService) {
  if(store.schemaVersion()!==3)throw new Error('Run memory:migrate -- --stopped before enabling an existing HDSI database');
  const e=settings.memoryEmbedding,key=environment[e.apiKeyEnv];if(!key)throw new Error(`set ${e.apiKeyEnv} for memory embeddings`);
  const oldSignature=storage.get<string>('memory_embedding_signature');
  const index=new MemoryIndex(store,new HttpEmbeddingProvider(e.model,e.baseUrl,key,fetch,e.dimensions),{clock,queryTimeoutMs:settings.memory.queryTimeoutMs,cacheSize:settings.memory.cacheSize,cacheTtlMs:settings.memory.cacheTtlMs});
  if(oldSignature!==index.configSignature||storage.get('memory_index_rebuild_required'))storage.transaction(()=>{for(const row of store.selectCandidates({query:'',at:clock.now(),phase:'index_registration',scope:'archive',includeDetailHistory:false,permissions:{allowArchive:true,allowDetailHistory:false,visibleSourceIds:[]},budget:null}))store.queueIndex(row,clock.now(),index.configSignature);storage.set('memory_index_rebuild_required',false);});
  const calibration:RetrievalCalibration=settings.memory.calibrationFile?JSON.parse(readFileSync(settings.memory.calibrationFile,'utf8')).calibration:defaultCalibration;
  const lifecycle=new MemoryLifecycle(store),retrieval=new MemoryRetrieval(store,index,{...settings.memory.contextLimits,historyBudget:settings.historyBudget},calibration);
  const maintenance=new MemoryMaintenance(store,lifecycle,index,models,{clock,onReady,web,batchItems:settings.memory.batchItems,batchCharacters:settings.memory.batchCharacters,backgroundTimeoutMs:settings.memory.backgroundTimeoutMs,retryDelayMs:settings.memory.retryDelayMs});
  return {store,lifecycle,index,retrieval,maintenance};
}
