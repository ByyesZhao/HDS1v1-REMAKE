import {expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

function loadSmoke(build:string|undefined){
 const env={...process.env};
 if(build===undefined)delete env.HDSI_TEST_LIB_DIR;else env.HDSI_TEST_LIB_DIR=build;
 return spawnSync(process.execPath,['-e',`require(${JSON.stringify(resolve('runtime/plugin-smoke.cjs'))})`],{env,encoding:'utf8',timeout:10000});
}

it('smoke_uses_requested_build_path for both plugin and clock',()=>{
 const root=mkdtempSync(join(tmpdir(),'hdsi-smoke-build-'));
 try{
  writeFileSync(join(root,'index.js'),"process.stdout.write('isolated-plugin-loaded\\n');module.exports={};");
  writeFileSync(join(root,'time.js'),"process.stdout.write('isolated-clock-loaded\\n');module.exports={systemClock:{}};");
  const result=loadSmoke(root);
  expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);
  expect(result.stdout).toContain('isolated-plugin-loaded');expect(result.stdout).toContain('isolated-clock-loaded');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('smoke rejects an explicitly missing build instead of loading deployed lib',()=>{
 const root=mkdtempSync(join(tmpdir(),'hdsi-smoke-missing-'));
 try{
  const missing=join(root,'not-built');mkdirSync(missing);
  const result=loadSmoke(missing);
  expect(result.error).toBeUndefined();expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('not-built');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('smoke keeps the deployed lib default when no test path is supplied',()=>{
 const result=loadSmoke(undefined);
 expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);
 expect(result.stdout).not.toContain('isolated-plugin-loaded');
});
