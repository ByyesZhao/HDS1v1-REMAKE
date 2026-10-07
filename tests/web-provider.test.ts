import { expect,it } from 'vitest';
import type { WebSearchProvider } from '../src/web/provider';
import { UnconfiguredWebProvider } from '../src/web/provider';
it('keeps replaceable search and read APIs separate and leaves real service explicitly unconfigured',async()=>{
  const provider:WebSearchProvider={signature:'fixture',search:async()=>[{url:'https://example.test/a',title:'摘要列表'}],read:async()=>({title:'正文标题',body:'正文'})};expect((await provider.search('资料'))[0].title).toBe('摘要列表');expect((await provider.read('https://example.test/a')).body).toBe('正文');
  const none=new UnconfiguredWebProvider();expect(none.available).toBe(false);await expect(none.search('资料')).rejects.toThrow('not configured');await expect(none.read('https://example.test/a')).rejects.toThrow('not configured');
});
