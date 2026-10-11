import {it,expect} from 'vitest';import {createRequire} from 'node:module';import {resolve} from 'node:path';const {parseHTML}=createRequire(resolve('package.json'))('linkedom') as {parseHTML:(html:string)=>{document:Document}};import {Readability} from '@mozilla/readability';import {extractDomEvidence,extractSearchCandidates,extractReadablePage} from '../src/web/browser/extract';
const extract=(html:string,url='https://example.org/article',engine:any=null)=>extractDomEvidence(parseHTML(html).document as unknown as Document,url,engine,Readability as any);
it('nested_articles_emit_descendant_text_once',()=>{
 const page=extract('<article><p>OUTER_BODY</p><article><p>INNER_ARTICLE_UNIQUE</p></article></article>');
 expect(page.main?.source).toBe('article');expect(page.main!.text.split('INNER_ARTICLE_UNIQUE')).toHaveLength(2);expect(page.main!.text).toContain('OUTER_BODY');
});
it('nested_main_role_main_emit_descendant_text_once',()=>{
 const page=extract('<main><p>OUTER_MAIN_BODY</p><div role="main"><p>INNER_MAIN_UNIQUE</p></div></main>');
 expect(page.main?.source).toBe('main');expect(page.main!.text.split('INNER_MAIN_UNIQUE')).toHaveLength(2);expect(page.main!.text).toContain('OUTER_MAIN_BODY');
});
it('sibling_articles_keep_identical_paragraphs',()=>{
 const page=extract('<article><p>IDENTICAL_REAL_PARAGRAPH</p></article><article><p>IDENTICAL_REAL_PARAGRAPH</p></article>');
 expect(page.main!.text.split('IDENTICAL_REAL_PARAGRAPH')).toHaveLength(3);
});
it('non_body_candidate_does_not_hide_valid_descendant',()=>{
 const page=extract('<main><a href="/example"><div role="main"><p>VALID_DESCENDANT</p></div></a></main><article hidden>HIDDEN_DESCENDANT</article><aside><p>LOGIN_DESCENDANT</p><form><input type="password"></form></aside>');
 expect(page.access).toBe('ok');expect(page.main?.source).toBe('main');expect(page.main?.text).toBe('VALID_DESCENDANT');
});
it('extracts DOM candidates and exact full article, never query words or navigation as evidence',()=>{
 const page=extract('<html><body><input value="no results error"/><nav>无结果</nav></body></html>','https://www.bing.com/search?q=x','bing');
 expect(page.search!.state).toBe('unready');expect(()=>extractSearchCandidates(page,'bing')).toThrow();
 const results=extract('<ol id="b_results"><li class="b_algo"><h2><a href="https://example.org/a">一</a></h2></li></ol>','https://www.bing.com/search?q=x','bing');
 expect(extractSearchCandidates(results,'bing')).toEqual([{url:'https://example.org/a',title:'一'}]);expect(()=>extractReadablePage(results)).toThrow();
 const body=extract('<nav>NAV_ONLY_SENTINEL</nav><article><h1>正文</h1><p>'+ '全文内容。'.repeat(3000)+'END_OF_FULL_ARTICLE</p><p>这篇文章讨论登录和验证码。</p></article>');
 expect(body.access).toBe('ok');expect(body.main!.source).toBe('article');expect(extractReadablePage(body).body).toContain('END_OF_FULL_ARTICLE');expect(extractReadablePage(body).body).not.toContain('NAV_ONLY_SENTINEL');
});
it('distinguishes explicit engine empty and structural access walls, uses main body',()=>{
 expect(extract('<ol id="b_results"><li class="b_no">There are no results</li></ol>','https://www.bing.com/search?q=x','bing').search!.state).toBe('empty');
 expect(extract('<form><input type="password"/></form>').access).toBe('login_wall');
 expect(extract('<form id="challenge-form"><div id="captcha">Check</div></form>').access).toBe('captcha');
 expect(extract('<main><p>正文只有main</p></main>').main!.source).toBe('main');
 expect(extract('<nav>无结果</nav><div>页面导航</div>').main).toBeNull();
});
it('does not accept copyright-only footer as readable article',()=>{
 const p=extract('<html><body><nav>导航</nav><div id="footer"><div class="copyright">国家气象中心 版权所有 Copyright©2009-2026 '+ '版权所有 联系电话 地址 '.repeat(80)+'</div></div></body></html>');expect(p.main).toBeNull();
});
it('decodes Bing public redirect candidates; malformed and non-public links are excluded',()=>{
 const encoded='a1'+Buffer.from('https://example.org/article').toString('base64url');
 const p=extract('<ol id="b_results"><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u='+encoded+'">Redirect</a></h2></li></ol>','https://www.bing.com/search?q=x','bing');
 expect(extractSearchCandidates(p,'bing')[0].url).toBe('https://example.org/article');
});

it('ancestor hidden content and first hidden wall are not evidence',()=>{
 expect(extract('<div style="display:none"><article>HIDDEN</article></div><main>VISIBLE</main>').main?.text).toBe('VISIBLE');
 expect(extract('<form id="challenge-form" hidden>hidden</form><form id="captcha-form">visible</form>').access).toBe('captcha');
 const p=extract('<ol id="b_results"><li class="b_no" hidden>hidden</li><li class="b_no">empty</li></ol>','https://www.bing.com/search?q=x','bing');expect(p.search?.state).toBe('empty');
});
