import {it,expect} from 'vitest';import {createKoishiBrowserPort} from '../src/web/browser/koishi-port';import {extractDomEvidence} from '../src/web/browser/extract';import {createRequire} from 'node:module';import {resolve} from 'node:path';
const {parseHTML}=createRequire(resolve('package.json'))('linkedom');
it('navigates once, waits for dynamic DOM and surviving a navigation context replacement within one deadline',async()=>{
 let navigations=0,extracts=0,closed=0;const page={setRequestInterception:async()=>{},on(){},goto:async()=>{navigations++;return {status:()=>200};},url:()=> 'https://example.org/article',addScriptTag:async()=>{},evaluate:async(_fn:any,...args:any[])=>{if(args.length===0)return true;extracts++;if(extracts===1)throw Error('Execution context was destroyed, most likely because of a navigation.');return extractDomEvidence(parseHTML(extracts===2?'<main aria-busy="true"></main>':'<main>Dynamic final body</main>').document,'https://example.org/article');},close:async()=>{closed++;},isClosed:()=>!!closed,browser:()=>({connected:true})};
 const port=await createKoishiBrowserPort(async()=>page as any).openPage();
 expect((await port.read({kind:'article',url:'https://example.org/article'},{signal:new AbortController().signal,deadlineAt:performance.now()+1000})).main?.text).toBe('Dynamic final body');
 expect(navigations).toBe(1);expect(extracts).toBe(3);await port.close();expect(closed).toBe(1);
});
