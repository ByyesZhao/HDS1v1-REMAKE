import {it,expect,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {createRequire} from 'node:module';
import {startStopControl} from '../src/deployment/stop-control';
const tick=()=>new Promise<void>(r=>setImmediate(r));
it('local authenticated request waits for completed work; repeated request shares one drain',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hdsi-stop-')),file=join(dir,'control.json');let release!:()=>void;const gate=new Promise<void>(r=>release=r),exit=vi.fn(),stop=vi.fn(async()=>gate);
 const log=vi.fn(),control=await startStopControl(file,stop,{exit,log});
 try{
 const d=JSON.parse(await readFile(file,'utf8'));const url=`http://127.0.0.1:${d.port}/stop`;
 expect((await fetch(url,{method:'POST'})).status).toBe(403);expect(stop).not.toHaveBeenCalled();
 let returned=false;const a=fetch(url,{method:'POST',headers:{authorization:`Bearer ${d.token}`}}).then(async r=>{returned=true;return r.json();});
 await vi.waitFor(()=>expect(stop).toHaveBeenCalledTimes(1));expect(returned).toBe(false);expect(exit).not.toHaveBeenCalled();
 const b=fetch(url,{method:'POST',headers:{authorization:`Bearer ${d.token}`}}).then(r=>r.json());await vi.waitFor(()=>expect(log.mock.calls.length).toBe(2));release();expect(await a).toMatchObject({stopped:true});expect(await b).toMatchObject({stopped:true});await vi.waitFor(()=>expect(exit).toHaveBeenCalledTimes(1));expect(stop).toHaveBeenCalledTimes(1);
 }finally{release();await control.close();await rm(dir,{recursive:true,force:true});}
});
it('failed drain reports failure without terminating process',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'hdsi-stop-')),file=join(dir,'control.json'),exit=vi.fn(),control=await startStopControl(file,async()=>{throw Error('offline failure');},{exit});
 try{const d=JSON.parse(await readFile(file,'utf8'));const r=await fetch(`http://127.0.0.1:${d.port}/stop`,{method:'POST',headers:{authorization:`Bearer ${d.token}`}});expect(r.status).toBe(500);expect(exit).not.toHaveBeenCalled();}finally{await control.close();await rm(dir,{recursive:true,force:true});}
});
it('stop script uses local current descriptor and reports absent service without force kill',async()=>{
 const {requestStop}=createRequire(resolve('package.json'))('./runtime/stop.cjs');const dir=await mkdtemp(join(tmpdir(),'hdsi-stop-')),file=join(dir,'control.json'),control=await startStopControl(file,async()=>{}, {exit:()=>{}});
 try{expect(await requestStop(file,()=>{})).toMatchObject({stopped:true});await control.close();await expect(requestStop(file,()=>{})).rejects.toThrow('HDSI');}finally{await control.close();await rm(dir,{recursive:true,force:true});}
});
