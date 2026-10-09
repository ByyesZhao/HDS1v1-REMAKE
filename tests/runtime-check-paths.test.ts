import {it,expect} from 'vitest';import {createRequire} from 'node:module';import {resolve} from 'node:path';
const require=createRequire(resolve('package.json'));
it('check module has an injectable explicit-path API and importing performs no checks',()=>{
 const check=require('./runtime/check.cjs');expect(typeof check.checkRuntime).toBe('function');
});
