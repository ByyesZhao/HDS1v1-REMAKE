import type {WebStatusSummary} from './types';
const label=(v:string)=>v.slice(0,24),number=(v:number)=>v<1e7?String(v):v.toExponential(2);
export function renderWebStatus(s:WebStatusSummary):string{
 const t=s.totals;
 const current=s.currentOwners.map(o=>label(o.ownerType)+':'+label(o.ownerId)+' '+o.stages.map(r=>label(r.stageKey)+' '+number(r.counters.successReads)+'/'+number(s.limits.successReads)+' 成功，'+number(r.counters.failures)+'/'+number(s.limits.failures)+' 失败').join('；')+(o.omittedStages?'（另'+number(o.omittedStages)+'阶段）':'')).join('；');
 return '；网页（页面额度，非费用）：'+(s.enabled?'开启':'关闭')+'；会话'+number(t.sessions)+'／任务'+number(t.owners)+'／成功'+number(t.successReads)+'／失败'+number(t.failures)+'／缓存'+number(t.cacheHits)+'／搜索'+number(t.providerSearchCalls)+'／读取'+number(t.providerReadCalls)+(current?'；当前 '+current:'')+(s.omittedOwners?'；另'+number(s.omittedOwners)+'任务':'');
}
