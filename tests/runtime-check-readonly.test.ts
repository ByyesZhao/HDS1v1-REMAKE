import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,copyFileSync,symlinkSync,writeFileSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve,relative} from 'node:path';import {spawnSync} from 'node:child_process';
import {Storage} from '../src/storage';import {MemoryStore} from '../src/memory/store';import {NOW} from './helpers';

// Regression: constructing MemoryStore in the readonly launcher check tries missing-index DDL.
it.each([3,2])('launcher readonly check reads schema %i without installing missing auxiliary indexes',{timeout:15000},version=>{
 const root=mkdtempSync(join(tmpdir(),'hdsi-launcher-readonly-')),runtime=join(root,'runtime'),database=join(runtime,'data','hdsi-remake.sqlite');
 try{
  mkdirSync(runtime,{recursive:true});writeFileSync(join(runtime,'package.json'),'{}');
  copyFileSync(resolve('runtime/check.cjs'),join(runtime,'check.cjs'));
  symlinkSync(resolve('runtime/node_modules'),join(runtime,'node_modules'),'junction');
  const testLib=process.env.HDSI_TEST_LIB_DIR??resolve('lib');
  symlinkSync(testLib,join(root,'lib'),'junction');
  expect(realpathSync(join(root,'lib'))).toBe(realpathSync(testLib));
  const settings=JSON.parse(readFileSync('examples/story.sample.json','utf8'));
  settings.stickersEnabled=false;writeFileSync(join(root,'config.local.json'),JSON.stringify(settings));
  writeFileSync(join(root,'key.txt'),'deepseek KEY: synthetic-key\nqwen3.7-text-embedding KEY: synthetic-key');
  writeFileSync(join(root,'no-network.cjs'),"global.fetch=()=>{throw Error('network forbidden in launcher check fixture');};");
  const s=new Storage(database);const memories=new MemoryStore(s);memories.migrate(NOW);s.set('memory_schema_version',version);
  for(const row of s.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%_residual'").all())s.prepare('DROP INDEX "'+String(row.name).replaceAll('"','""')+'"').run();
  s.close();const before=readFileSync(database);
  const result=spawnSync(process.execPath,['--require',join(root,'no-network.cjs'),join(runtime,'check.cjs')],{cwd:root,encoding:'utf8',timeout:12000,env:{...process.env,DEEPSEEK_API_KEY:'synthetic-key',QWEN_API_KEY:'synthetic-key'}});
  expect(result.error).toBeUndefined();
  if(version===3)expect(result.status,result.stdout+'\n'+result.stderr).toBe(0);
  else{expect(result.status).not.toBe(0);expect(result.stderr).toContain('memory:migrate');}
  expect(readFileSync(database)).toEqual(before);
  const readonly=new Storage(database,{readOnly:true});
  try{expect(readonly.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE '%_residual'").all()).toHaveLength(0);}
  finally{readonly.close();}
 }finally{
  const within=relative(resolve(tmpdir()),resolve(root));if(within.startsWith('..'))throw Error('fixture outside temporary directory');
  rmSync(root,{recursive:true,force:true});
 }
});
