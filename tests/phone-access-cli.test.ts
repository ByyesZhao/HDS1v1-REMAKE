import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve,win32} from 'node:path';
import {runInNewContext} from 'node:vm';
const filename=resolve('docs/v0.5/records/phone-access-20261010/repair-state.cjs');
function invoke(args:string[]){
 const writes:string[]=[],errors:string[]=[],opened:string[]=[];
 const fakeFs={constants:{COPYFILE_EXCL:1},existsSync:()=>true,mkdirSync:(p:string)=>writes.push(`mkdir:${p}`),copyFileSync:(a:string,b:string)=>writes.push(`copy:${a}:${b}`),writeFileSync:(p:string)=>writes.push(`write:${p}`)};
 class Storage {constructor(p:string){opened.push(p);}unfinishedTurn(){return {};}close(){}}
 const mod={exports:{}};
 const req:any=(name:string)=>name==='node:fs'?fakeFs:name==='node:path'?win32:name==='node:crypto'?require('node:crypto'):{Storage};req.main=mod;
 const process={argv:['node',filename,...args],platform:'win32',exitCode:0};
 runInNewContext(readFileSync(filename,'utf8'),{require:req,module:mod,__dirname:win32.dirname(filename),process,console:{log:()=>{},error:(s:string)=>errors.push(s)}});
 return {writes,errors,opened,exitCode:process.exitCode};
}
for(const suffix of ['','-wal','-shm']){
 it(`check rejects report collision with database${suffix} before opening or writing`,()=>{
  const r=invoke(['--database','D:\\data\\hdsi.sqlite','--check','--report',`d:\\DATA\\hdsi.sqlite${suffix}`]);
  expect(r.exitCode).toBe(1);expect(r.errors.join(' ')).toMatch(/report.*database|report.*backup/i);expect(r.opened).toEqual([]);expect(r.writes).toEqual([]);
 });
 it(`apply rejects report collision with backup${suffix} before any database or file operation`,()=>{
  const r=invoke(['--database','D:\\data\\hdsi.sqlite','--apply','--stopped','--backup','D:\\backup','--report',`d:\\BACKUP\\hdsi-remake.sqlite${suffix}`]);
  expect(r.exitCode).toBe(1);expect(r.errors.join(' ')).toMatch(/report.*database|report.*backup/i);expect(r.opened).toEqual([]);expect(r.writes).toEqual([]);
 });
}
it('separate report path leaves the database untouched during check',()=>{
 const r=invoke(['--database','D:\\data\\hdsi.sqlite','--check','--report','D:\\reports\\check.json']);
 expect(r.exitCode).toBe(0);expect(r.errors).toEqual([]);expect(r.opened).toEqual(['D:\\data\\hdsi.sqlite']);expect(r.writes).toEqual(['mkdir:D:\\reports','write:D:\\reports\\check.json']);
});
