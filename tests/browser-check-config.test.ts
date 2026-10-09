import {it,expect} from 'vitest';import {createRequire} from 'node:module';import {resolve} from 'node:path';
const {enabledPuppeteer}=createRequire(resolve('package.json'))('./runtime/check.cjs');
it('reads only enabled plugins/group tree, honors suffix and disabled groups',()=>{
 expect(enabledPuppeteer({'group:a':{'puppeteer:one':{}}})).toBe(true);expect(enabledPuppeteer({'~group:a':{puppeteer:{}}})).toBe(false);expect(enabledPuppeteer({'group:a':{'~puppeteer:one':{}}})).toBe(false);expect(enabledPuppeteer({other:{puppeteer:{}}})).toBe(false);
});
