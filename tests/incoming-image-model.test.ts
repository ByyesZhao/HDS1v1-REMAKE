import {it,expect} from 'vitest';
import {ChatCompletionsTransport,ModelClient} from '../src/model/client';
import {observeIncomingImage} from '../src/input-media/observe';
it('sends real image_url, strips transfer fields from text and keeps image during repair',async()=>{
 const bodies:any[]=[];let n=0;
 const transport=new ChatCompletionsTransport(()=>({model:'deepseek-v4-flash',reasoningEffort:'high',apiKey:'synthetic',baseUrl:'https://offline.test'}),async(_u,init)=>{bodies.push(JSON.parse(String(init!.body)));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(n++===0?{description:3}:{description:'猫',visibleText:[],possibleTone:null,uncertain:false})}}]}));},async()=> 'data:image/png;base64,AAAA');
 const result=await observeIncomingImage(new ModelClient(transport),'asset-1',{lookup:null});
 expect(result.description).toBe('猫');expect(bodies).toHaveLength(2);
 for(const b of bodies){expect(b.messages[1].content[1]).toEqual({type:'image_url',image_url:{url:'data:image/png;base64,AAAA'}});expect(b.messages[1].content[0].text).not.toContain('asset-1');expect(b.messages[1].content[0].text).not.toContain('data:image');expect(b.model).toBe('deepseek-v4-flash');expect(b.reasoning_effort).toBe('high');}
});
