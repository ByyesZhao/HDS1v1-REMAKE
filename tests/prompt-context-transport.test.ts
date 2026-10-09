import { it,expect } from 'vitest';
import { ChatCompletionsTransport } from '../src/model/client';
import { stageInput } from '../src/model/context-views';
import { modelTask } from '../src/model/contracts';
import { z } from 'zod';
import { buildCompletionEnvelope } from '../src/model/resource-pool';
import type { WebMaterial } from '../src/web/types';
const material:WebMaterial={id:'page',url:'https://example.test',title:'标题',body:'唯一网页长正文完整尾部',readAt:'2026-10-08T00:00:00Z',bodyCharacters:11,selectionMode:'full_body',sourceKind:'external_reference'};
function fixture(mode:'json_object'|'json_schema'='json_object'){const bodies:any[]=[];const t=new ChatCompletionsTransport(()=>({model:'deepseek-flash',apiKey:'offline',baseUrl:'https://example.test',outputMode:mode}),(async(_u,o)=>{bodies.push(JSON.parse(String(o?.body)));return new Response(JSON.stringify({choices:[{message:{content:'{}'}}]}));}) as typeof fetch);return {t,bodies};}
it('lookup_identical_school_once; different_message_ids_same_text_preserved',()=>{
 const school={knownSnapshots:[{id:'school-one',revision:1,text:'唯一学校正文标记'}]},input=stageInput('personal_chat',{school,visibleMessages:[{id:'a',direction:'incoming',content:'same',receivedAt:'now'},{id:'b',direction:'incoming',content:'same',receivedAt:'now'}] as any});
 const lookup={details:[],school:structuredClone(school)},before=JSON.stringify({input,lookup});
 const envelope=buildCompletionEnvelope({task:modelTask('personal_chat',z.object({})),input,lookupResult:lookup});
 expect(JSON.stringify(envelope).split('唯一学校正文标记')).toHaveLength(2);
 expect(envelope.lookupResult).toMatchObject({contextRefs:{school:'input.context.school'}});
 expect(envelope.resources.messages.map(m=>m.id)).toEqual(['a','b']);expect(JSON.stringify({input,lookup})).toBe(before);
});
it('lookup_new_school_version_kept; lookup_different_detail_history_kept',()=>{
 const input=stageInput('personal_chat',{school:{knownSnapshots:[{id:'s',revision:1,text:'old'}]},detailHistory:[{id:'d1',value:'old'}] as any});
 const lookup={details:[],school:{knownSnapshots:[{id:'s',revision:2,text:'new'}]},detailHistory:[{id:'d2',value:'new'}]};
 const envelope=buildCompletionEnvelope({task:modelTask('personal_chat',z.object({})),input,lookupResult:lookup});
 expect(envelope.lookupResult).toMatchObject({context:{school:lookup.school,detailHistory:lookup.detailHistory}});
 expect(envelope.lookupResult).not.toHaveProperty('contextRefs');
});
it('transport_explains_reused_context_paths_only_when_lookup_uses_them',async()=>{
 const {t,bodies}=fixture(),school={knownSnapshots:[{id:'s',revision:1,text:'同一正文'}]},input=stageInput('personal_chat',{school}),task=modelTask('personal_chat',z.object({}));
 await t.complete({task,input,lookupResult:{school:structuredClone(school)}});
 const envelope=JSON.parse(bodies[0].messages[1].content);expect(envelope.lookupResult.contextRefs.school).toBe('input.context.school');expect(bodies[0].messages[0].content).toMatch(/lookupResult\.contextRefs.*input\.context/);expect(bodies[0].messages[0].content).toMatch(/新来源/);
 await t.complete({task,input});expect(bodies[1].messages[0].content).not.toContain('lookupResult.contextRefs');
});
it('web_body_once_across_input_results_lookup and each continuation has complete available bodies',async()=>{
 const {t,bodies}=fixture(),input=stageInput('memory',{selfWebReadMaterials:[{sourceId:'s',material}]});const result={materials:[material],counters:{successReads:1,failures:0},stopReason:'satisfied' as const};const request={task:modelTask('memory',z.object({})),input,webMaterials:[material],webResults:[result,result],lookupResult:{materials:[material]},tools:{web:false,lookup:false}};const before=JSON.stringify(request);
 await t.complete(request);const body=JSON.parse(bodies[0].messages[1].content);expect(JSON.stringify(body).split(material.body)).toHaveLength(2);expect(body.resources.materials).toHaveLength(1);expect(body.webResults[0].materialIds).toEqual(['page']);expect(body.webResults[0]).not.toHaveProperty('materials');expect(JSON.stringify(request)).toBe(before);
 const second={...material,id:'second',body:'后续正文'};await t.complete({...request,webMaterials:[material,second]});const next=JSON.parse(bodies[1].messages[1].content);expect(next.resources.materials.map((m:any)=>m.body)).toEqual([material.body,'后续正文']);
});
it('image_payload_preserved_without_json_base64_copy and vision rules scoped',async()=>{
 const {t,bodies}=fixture(),url='data:image/png;base64,fixture';await t.complete({task:modelTask('sticker_description',z.object({description:z.string()})),input:stageInput('sticker_description',{imageDataUrl:url}),tools:{web:false,lookup:false}});const content=bodies[0].messages[1].content;expect(content[1]).toEqual({type:'image_url',image_url:{url}});expect(content[0].text).not.toContain(url);expect(bodies[0].messages[0].content).not.toMatch(/activity.startsAt|表达阶段仅|projectionBasis/);
});
it('json_object_keeps_schema and json_schema_single_schema_when_configured',async()=>{
 for(const mode of ['json_object','json_schema'] as const){const {t,bodies}=fixture(mode);await t.complete({task:modelTask('expression',z.object({uniqueSchemaMarker:z.string()})),input:stageInput('expression',{}),tools:{web:false,lookup:false}});expect(JSON.stringify(bodies[0]).split('uniqueSchemaMarker').length).toBe(3);if(mode==='json_schema'){expect(bodies[0].messages[0].content).not.toContain('JSON Schema:');expect(bodies[0].response_format.json_schema.schema.properties.uniqueSchemaMarker).toBeDefined();}else expect(bodies[0].messages[0].content).toContain('JSON Schema:');}
});
