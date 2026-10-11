import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function assertDistinctRetrievalPaths(paths:string[]):void {
  for(let i=0;i<paths.length;i++)for(let j=i+1;j<paths.length;j++){
    const left=resolve(paths[i]),right=resolve(paths[j]);
    const a=statSync(left,{bigint:true,throwIfNoEntry:false}),b=statSync(right,{bigint:true,throwIfNoEntry:false});
    if((process.platform==='win32'?left.toLowerCase()===right.toLowerCase():left===right)||a&&b&&a.dev===b.dev&&a.ino===b.ino)throw Error('output alias must not overwrite an input file or another output');
  }
}
export function writeRetrievalJson(path:string,value:unknown,exclusive=false):void {
  mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(value,null,2)+'\n',{flag:exclusive?'wx':'w'});
}
