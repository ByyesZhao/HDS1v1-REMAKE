import {join,resolve,relative} from 'node:path';
import type {Transport} from '../src/model/client';
export function acceptancePaths(projectRoot:string,runId:string){
 if(!/^[a-zA-Z0-9-]+$/.test(runId))throw Error('invalid acceptance run identity');
 const root=join(resolve(projectRoot),'runtime','data','world-school-acceptance',runId);
 return {root,database:join(root,'story.sqlite')};
}
export function isolatedResumePath(projectRoot:string,from:string){
 const path=resolve(from),rel=relative(join(resolve(projectRoot),'runtime','data','world-school-acceptance'),path);
 if(!/^[a-zA-Z0-9-]+[\\/]story\.sqlite$/.test(rel))throw Error('resume must be an isolated acceptance SQLite');
 return path;
}
export function withRequestTimeout(transport:Transport,timeoutMs=300_000):Transport{
 if(!Number.isInteger(timeoutMs)||timeoutMs<=0)throw Error('invalid request timeout');
 return {complete:(request,options)=>transport.complete(request,{signal:options?.signal
  ?AbortSignal.any([options.signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)})};
}
