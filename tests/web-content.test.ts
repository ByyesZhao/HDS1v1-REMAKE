import { expect,it } from 'vitest';
import { normalizeMaterial,normalizeWebUrl,parseWebTool } from '../src/web/content';
it('removes navigation and scripts while retaining long body tail and Unicode codepoint size',()=>{
  const body=`<html><nav>菜单广告</nav><script>untrusted()</script><main><p>${'资料正文'.repeat(4000)}😀尾部标记</p></main></html>`;
  const m=normalizeMaterial({id:'m',url:'https://EXAMPLE.test:443/a#section',title:'资料',body,readAt:'2026-10-07T00:00:00Z',selectionMode:'full_body'});expect(m.body).not.toContain('菜单');expect(m.body).not.toContain('untrusted');expect(m.body.endsWith('😀尾部标记')).toBe(true);expect(m.bodyCharacters).toBe([...m.body].length);expect(m.body.length).toBeGreaterThan(12000);expect(m.url).toBe('https://example.test/a');expect(m.sourceKind).toBe('external_reference');
});
it('labels selected passages honestly and counts spaces in the supplied normalized body',()=>{
  const m=normalizeMaterial({id:'m',url:'https://example.test',title:'',body:'A 😀 B',readAt:'2026-10-07T00:00:00Z',selectionMode:'relevant_passages'});expect(m.selectionMode).toBe('relevant_passages');expect(m.bodyCharacters).toBe(5);expect(normalizeWebUrl('https://example.test/a?q=1#b')).toBe('https://example.test/a?q=1');
});
it('validates model business tool requests without accepting model-generated operation IDs or search snippets as body',()=>{
  expect(parseWebTool({webSearch:{query:'资料'}})).toEqual({kind:'search',request:{query:'资料',requestedPages:1}});expect(parseWebTool({webRead:{url:'https://example.test/a'}})).toEqual({kind:'read',url:'https://example.test/a'});expect(()=>parseWebTool({webSearch:{query:'',requestedPages:0}})).toThrow();expect(()=>parseWebTool({webRead:{url:'file:///secret'}})).toThrow();expect(parseWebTool({changes:[]})).toBeNull();
  expect(()=>normalizeMaterial({id:'m',url:'https://example.test',title:'摘要',body:'<nav>菜单</nav>',readAt:'2026-10-07T00:00:00Z',selectionMode:'full_body'})).toThrow('empty body');
});
