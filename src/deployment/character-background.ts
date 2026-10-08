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

export interface BackgroundParagraphMapping {paragraph:number;uses:Array<'core'|'style'|'world'|'campus'|'group'>;text:string}
export function prepareBackgroundViews(original:string,mapping:BackgroundParagraphMapping[],facts:BackgroundSelection[]=[]):import('../model/background-views').BackgroundViews {
 const paragraphs=original.split(/\r?\n\s*\r?\n/);
 if([...mapping,...facts].some(r=>r.paragraph<0||r.paragraph>=paragraphs.length))throw Error('unknown background paragraph');
 const field=(use:BackgroundParagraphMapping['uses'][number])=>mapping.filter(r=>r.uses.includes(use)).map(r=>r.text).join('\n\n');
 return {version:1,status:'candidate_pending_review',core:field('core'),style:field('style'),world:field('world'),campus:field('campus'),group:field('group'),facts:facts.map(f=>({key:f.key,value:f.value,aliases:f.aliases,source:{paragraph:f.paragraph,original:paragraphs[f.paragraph]}})),sourceMap:mapping.map(r=>({...r,original:paragraphs[r.paragraph]}))};
}
