import {it,expect} from 'vitest';import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {prepareFeatureCheck,verifyFeatureCheck} from '../scripts/prepare-feature-check';import {createRequire} from 'node:module';import {resolve} from 'node:path';
it('creates a self-contained image check fixture, real readonly check does not change it',()=>{
 const root=mkdtempSync(join(tmpdir(),'hdsi-feature-check-'));try{
 const paths=prepareFeatureCheck('image',root),sample=JSON.parse(readFileSync(paths.configPath,'utf8'));
 expect(sample.backgroundFile).toBeUndefined();expect(sample.visualInput.enabled).toBe(true);expect(sample.stickersEnabled).toBe(false);
 const require=createRequire(resolve('package.json'));process.env.HDSI_FEATURE_DEEPSEEK='synthetic';process.env.HDSI_FEATURE_EMBEDDING='synthetic';
 require('./runtime/check.cjs').checkRuntime(paths,{log:()=>{}});
 expect(verifyFeatureCheck(root)).toBe(true);expect(()=>prepareFeatureCheck('image',root)).toThrow('empty');
 }finally{delete process.env.HDSI_FEATURE_DEEPSEEK;delete process.env.HDSI_FEATURE_EMBEDDING;rmSync(root,{recursive:true,force:true});}
});
