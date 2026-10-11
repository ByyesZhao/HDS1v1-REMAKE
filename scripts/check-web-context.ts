import {writeFileSync,mkdirSync} from 'node:fs';
import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {MemoryRetrieval,makeRetrievalRequest} from '../src/memory/retrieval';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
import {ModelClient} from '../src/model/client';
import {modelTask} from '../src/model/contracts';
import {z} from 'zod';
import {addMs} from '../src/time';
async function main(){const now='2026-10-07T10:00:00+08:00',db=new Storage(':memory:'),store=new MemoryStore(db);store.migrate(now);const body='公开资料正文。'.repeat(3000)+'尾部保留';
 db.transaction(()=>{for(let i=0;i<10000;i++)store.saveOwner(store.makeOwner({ownerType:'long',ownerId:`m${i}`},{content:i<100?'手机生日经历与对应感受':'数学考试复习',topics:i<100?['手机']:['考试'],sourceIds:['offline'],retainedFrom:now,expiresAt:addMs(now,200*86400000)},now));for(let i=0;i<35;i++)db.save('messages',`msg${i}`,{id:`msg${i}`,content:'近期原文',receivedAt:addMs(now,i),platformMessageIds:[],direction:'incoming',seenTurnId:'old',batchId:null,turnId:'old',outboxSeq:null});});
 const retrieval=new MemoryRetrieval(store,undefined),ws=new WebSearchStore(db),report=[];
 for(const months of [3,6]){const at=addMs(now,months*30*86400000),start=performance.now(),history=await retrieval.build(makeRetrievalRequest('手机生日经历',at,'personal_chat'));let characters=0,provided=0;
 const web=new WebSearchService(ws,{signature:'fixture',search:async()=>[{url:'https://example.test/public',title:'公开'}],read:async()=>({bodyFormat:'text' as const,title:'正文',body})},{now:()=>at},{enabled:true}),session=web.openSession(ws.openStage('turn',`month${months}`,'personal','personal_chat'));
 await new ModelClient({complete:async r=>{if(!r.webMaterials?.length)return {webSearch:{query:'公开资料'}};characters=[...JSON.stringify(r)].length;provided=r.webMaterials.length;return {answer:'ok'};}}).runModel(modelTask('personal_chat',z.object({answer:z.string()})),{history},{web:session,lookup:null});
 report.push({months,storedMemories:10000,selectedRelated:history.longTerm.length,irrelevantSelected:history.longTerm.filter(r=>Number(r.id.slice(1))>=100).length,recentOriginals:history.recent.length,injectedPages:provided,pageBodyCharacters:[...body].length,tailPreserved:session.snapshot().materials[0].body.endsWith('尾部保留'),stageRequestCharacters:characters,offlineMs:performance.now()-start,counters:session.snapshot().counters});}
 db.close();const data={generatedAt:new Date().toISOString(),synthetic:true,providerStatus:'待真实供应商接入；未联网',capacityStatus:'仅观察字符和实际注入份数；未换算token，未验证供应商容量',samples:report};mkdirSync('runtime/data',{recursive:true});writeFileSync('runtime/data/web-context-observation.json',JSON.stringify(data,null,2));console.log(JSON.stringify(data,null,2));}
void main();
