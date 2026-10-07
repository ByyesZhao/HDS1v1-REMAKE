export interface BackgroundSelection {paragraph:number;key:string;value:string;aliases:string[]}
export function prepareCharacterBackground(input:string,selection:BackgroundSelection[]=[]) {
  const paragraphs=input.split(/\r?\n\s*\r?\n/),selected=new Set(selection.map(s=>s.paragraph));
  if(selection.some(s=>s.paragraph<0||s.paragraph>=paragraphs.length))throw new Error('background selection references unknown paragraph');
  return {status:selection.length?'candidate_pending_review':'review_required',
    core:selection.length?paragraphs.filter((_,i)=>!selected.has(i)).join('\n\n'):input,
    details:selection.map(({key,value,aliases})=>({key,value,aliases})),
    sourceMap:selection.map(({paragraph,key})=>({paragraph,key,original:paragraphs[paragraph]})),
    paragraphs:paragraphs.map((content,paragraph)=>({paragraph,content,decision:selected.has(paragraph)?'detail':'keep'}))};
}
