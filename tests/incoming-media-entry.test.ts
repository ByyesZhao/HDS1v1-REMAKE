import {expect,it,vi} from 'vitest';
import {parseIncomingContent} from '../src/input-media/parse';
import {InputBuffer} from '../src/host/input';
import {IncomingMediaStore} from '../src/input-media/store';
import {Storage} from '../src/storage';
vi.mock('koishi',async()=>(await import('node:module')).createRequire(`${process.cwd()}/package.json`)('koishi'));
it('preserves exact text/attachment appearance, current content only, numeric order',()=>{
 const p=parseIncomingContent('m','甲<img src="https://a.test/a.png"/>乙<face id="14"><img src="https://a.test/face"/></face><mface key="opaque"/>丙');
 expect(p.attachments.map(a=>a.kind)).toEqual(['image','native_face','market_sticker']);
 expect(p.contentParts.filter(a=>a.kind==='attachment').map(a=>p.content.slice(a.start,a.end))).toHaveLength(3);
 expect(p.attachments.map(a=>a.id)).toEqual([0,1,2].map(n=>JSON.stringify(['m',n])));
 expect(p.content).toContain('甲');expect(p.content).toContain('丙');
 const many=parseIncomingContent('z',Array.from({length:12},()=>'<img/>').join(''));
 expect(many.attachments.map(a=>a.order)).toEqual(Array.from({length:12},(_,i)=>i));
});
it('atomically persists reference-only messages and deduplicates redelivery',async()=>{
 const db=new Storage(':memory:'),media=new IncomingMediaStore(db);
 const input=new InputBuffer(db,undefined,undefined,undefined,media);
 const p=parseIncomingContent('m','【推进】<img src="https://a.test/private"/>');
 await input.acceptInput({id:'m',receivedAt:'2026-10-09T10:00:00+08:00',...p});
 await input.acceptInput({id:'m',receivedAt:'2026-10-09T10:00:00+08:00',...p});
 expect(db.all('message_attachments')).toHaveLength(1);expect(db.all('control_requests')).toHaveLength(0);
 expect(JSON.stringify(db.messages())).not.toContain('https://');expect(JSON.stringify(db.messages())).not.toContain('attachments');
 expect(db.messages()[0].attachmentIds).toEqual(p.attachments.map(a=>a.id));db.close();
});
