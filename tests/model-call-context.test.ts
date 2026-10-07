import { expect, it } from 'vitest';
import { ModelClient, ChatCompletionsTransport } from '../src/model/client';
import type { ModelTask } from '../src/types';
const task:ModelTask<{answer:string}>={name:'memory',schema:{},prompt:'',parse(value:any){if(typeof value?.answer!=='string')throw new Error('answer required');return value;}};
it('isolates concurrent lookup/repair/signal state and permits only one lookup per run',async()=>{
  const requests:any[]=[];const counts:Record<string,number>={};const client=new ModelClient({complete:async(r,opts)=>{requests.push({r,opts});const id=(r.input as any).id;counts[id]=(counts[id]??0)+1;return counts[id]===1?{lookupDetails:{query:id,scope:'current',includeDetailHistory:false}}:{answer:(r.lookupResult as any).answer};}});
  const a=new AbortController(),b=new AbortController();const outputs=await Promise.all([client.runModel(task,{id:'a'},{signal:a.signal,lookup:async q=>({answer:(q as any).query})}),client.runModel(task,{id:'b'},{signal:b.signal,lookup:async q=>({answer:(q as any).query})})]);
  expect(outputs.map(r=>r.answer)).toEqual(['a','b']);expect(requests.filter(r=>r.r.input.id==='a').every(r=>r.opts.signal===a.signal)).toBe(true);expect(requests.filter(r=>r.r.input.id==='b').every(r=>r.opts.signal===b.signal)).toBe(true);
});
it('lookup=null disables the legacy callback and abort is not repaired as invalid JSON',async()=>{
  let lookups=0,calls=0;const client=new ModelClient({complete:async()=>{calls++;return{lookupDetails:'secret'};}},()=>{lookups++;return{answer:'bad'};});await expect(client.runModel(task,{}, {lookup:null})).rejects.toThrow('answer required');expect(lookups).toBe(0);expect(calls).toBe(3);
  calls=0;const aborted=new ModelClient({complete:async()=>{calls++;throw new DOMException('stopped','AbortError');}});await expect(aborted.runModel(task,{}, {signal:new AbortController().signal})).rejects.toThrow('stopped');expect(calls).toBe(1);
});
it('repair and lookup continuations keep the configured task and HTTP forwards signal without output caps',async()=>{
  let init:any;const controller=new AbortController();const transport=new ChatCompletionsTransport(()=>({model:'deepseek-flash',baseUrl:'https://example.test',apiKey:'test-only',reasoningEffort:'high'}),(async(_url,options)=>{init=options;return new Response(JSON.stringify({choices:[{message:{content:'{"answer":"ok"}'}}]}));}) as typeof fetch);
  await transport.complete({task,input:{}},{signal:controller.signal});expect(init.signal).toBe(controller.signal);const body=JSON.parse(init.body);expect(body.reasoning_effort).toBe('high');expect(body.max_tokens).toBeUndefined();expect(body.max_completion_tokens).toBeUndefined();
});
