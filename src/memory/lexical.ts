// Versioned alongside the offline calibration report.
export const lexicalTemplate = 'effective-terms-v1';
export const genericTerms = ['还记得','回忆一下','以前','之前','去年','那次','你的','我们','什么','现在','一下','聊聊','今天','继续','经历','故事','生活','计划','聊天','她','吗','的','用','呢'];
export function queryTerms(query:string):string[] {
  let effective=query.toLowerCase();for(const term of genericTerms)effective=effective.replaceAll(term,' ');
  const terms:string[]=[...(effective.match(/[a-z]+|\d+/g)??[])];
  for(const run of effective.match(/\p{Script=Han}+/gu)??[]) {const chars=[...run];if(chars.length===1)terms.push(run);for(let i=0;i<chars.length-1;i++)terms.push(chars[i]+chars[i+1]);}
  return [...new Set(terms)];
}
export function lexicalCoverage(query:string,content:string):number {
  const normalized=content.toLowerCase();
  return Math.max(0,...query.split(/[\n，。？！!?；;]/).map(part=>{const terms=queryTerms(part);return terms.length?terms.filter(t=>normalized.includes(t)).length/terms.length:0;}));
}
export interface LabeledScore { score:number; relevant:boolean }
export function metrics(rows:LabeledScore[],threshold:number) {
  let tp=0,fp=0,fn=0;for(const row of rows){if(row.score>=threshold&&row.score>0){if(row.relevant)tp++;else fp++;}else if(row.relevant)fn++;}
  return {tp,fp,fn,precision:tp/(tp+fp||1),recall:tp/(tp+fn||1),f1:2*tp/(2*tp+fp+fn||1)};
}
export function calibrate(rows:LabeledScore[]) {
  return [...new Set(rows.map(r=>r.score).filter(s=>s>0))].map(threshold=>({threshold,...metrics(rows,threshold)})).sort((a,b)=>b.f1-a.f1||b.threshold-a.threshold)[0]??{threshold:1,...metrics(rows,1)};
}
