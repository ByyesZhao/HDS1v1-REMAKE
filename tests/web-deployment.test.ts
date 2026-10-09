import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {Storage} from '../src/storage';
import {loadSettings} from '../src/settings';
import {WebSearchService} from '../src/web/service';
import {WebSearchStore} from '../src/web/store';
import {TestClock} from './helpers';
it('defaults disabled with 20/40, advertises no unavailable tools and rejects enabled without a provider',()=>{
 const settings=loadSettings('examples/story.sample.json',{});expect(settings.webSearch).toMatchObject({enabled:false,provider:'unconfigured',maxSuccessReads:20,maxFailures:40});expect(JSON.stringify(settings.webSearch)).not.toMatch(/Characters|tokens/);
 const db=new Storage(':memory:');try{const store=new WebSearchStore(db),clock=new TestClock(),web=new WebSearchService(store,undefined,clock);expect(web.openSession(store.openStage('turn','t','world','world')).available).toBe(false);expect(()=>new WebSearchService(store,undefined,clock,{enabled:true})).toThrow('provider not configured');}finally{db.close();}
});
it('production no longer eagerly reads configured URLs or truncates at 12000 characters',()=>{
 const src=readFileSync('src/deployment/plugin-runtime.ts','utf8');expect(src).not.toContain('getWebMaterials');expect(src).not.toContain('slice(0, 12000)');expect(src).toContain('assembleWeb');
});
