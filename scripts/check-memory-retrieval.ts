import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Storage } from '../src/storage';
import { MemoryStore } from '../src/memory/store';
import { MemoryRetrieval,makeRetrievalRequest } from '../src/memory/retrieval';
import { lexicalCoverage,calibrate,metrics,genericTerms,lexicalTemplate } from '../src/memory/lexical';
import { addMs } from '../src/time';
interface Label {split:'train'|'validation';group:'fact'|'experience';query:string;content:string;relevant:boolean}
async function main(){
  const labels=JSON.parse(readFileSync(resolve('tests/fixtures/memory-retrieval-labels.json'),'utf8')) as Label[];
  const lexical:any={},groups:any={};
  for(const group of ['fact','experience'] as const){
    const scores=(split:Label['split'])=>labels.filter(l=>l.group===group&&l.split===split).map(l=>({score:lexicalCoverage(l.query,l.content),relevant:l.relevant}));
    const choice=calibrate(scores('validation'));lexical[group]=choice.threshold;groups[group]={validation:choice,training:metrics(scores('train'),choice.threshold),trainingCount:scores('train').length,validationCount:scores('validation').length};
  }
  const now='2026-10-07T10:00:00+08:00',storage=new Storage(':memory:'),store=new MemoryStore(storage);store.migrate(now);
  storage.transaction(()=>{for(let i=0;i<10000;i++){const row=store.makeOwner({ownerType:'long',ownerId:`bench${i}`},{content:i<100?'手机生日经历全部尾部':'数学考试复习',topics:i<100?['手机']:['考试'],sourceIds:['offline-fixture'],retainedFrom:now,expiresAt:addMs(now,200*86400000)},now);store.saveOwner(row);}});
  const retrieval=new MemoryRetrieval(store,undefined,{}, {lexical,semantic:null}),benchmarks=[];
  for(const months of [3,6]){const t=performance.now(),context=await retrieval.build(makeRetrievalRequest('手机生日经历',addMs(now,months*30*86400000),'personal_chat'));benchmarks.push({months,rows:10000,sqlCandidates:retrieval.metrics.candidates,sqlMs:retrieval.metrics.sqlMs,endToEndOfflineMs:performance.now()-t,recall:context.longTerm.length/100,falsePositives:context.longTerm.filter(r=>Number(r.id.slice(5))>=100).length,selected:context.longTerm.length,inputVisibleCharacters:[...JSON.stringify(context)].length});}
  storage.close();
  const report={generatedAt:new Date().toISOString(),fixture:'tests/fixtures/memory-retrieval-labels.json',lexicalTemplate,genericTerms,rule:'覆盖度按自然话题行／句计算，先去通用词；验证集观察切分点最大F1，同分取较高阈值',calibration:{lexical,semantic:null},groups,semanticStatus:'待真实Qwen标定；semantic-only关闭；离线数据不代表供应商延迟／容量',benchmarks};
  mkdirSync('runtime/data',{recursive:true});writeFileSync('runtime/data/memory-retrieval-calibration.json',JSON.stringify(report,null,2));console.log(JSON.stringify({path:'runtime/data/memory-retrieval-calibration.json',lexical,groups,benchmarks,semanticStatus:report.semanticStatus},null,2));
}
void main();
