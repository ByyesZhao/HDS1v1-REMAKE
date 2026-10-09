import {it,expect,vi} from 'vitest';
import {modern} from './chat-fixture';
import {SerialHost} from '../src/host/runtime';
import {HdsiApp} from '../src/app';
import {NOW} from './helpers';
it('routine input with fixed working set does not decode unrelated historical tables',async()=>{
 const costs:number[]=[];for(const n of [1000,10000,50000]){
 const d=modern();d.storage.transaction(()=>{for(let i=0;i<n;i++){d.storage.save('turns','t'+i,{id:'t'+i,done:true} as any);d.storage.save('chat_episodes','c'+i,{id:'c'+i,openedAt:'2020-01-01T00:00:00Z',lastInteractionAt:'2020-01-01T00:00:00Z',status:'closed',closedAt:'2020-01-01T00:15:00Z',closeReason:'idle'});d.storage.save('messages','history'+i,{id:'history'+i,content:'无关已读',direction:'incoming',receivedAt:'2020-01-01T00:00:00Z',platformMessageIds:[],seenTurnId:'t'+i,turnId:null,batchId:null,outboxSeq:null,chatEpisodeId:'c'+i,sharedActivityId:null});}});
 d.storage.set('runtime',{...d.storage.runtime(),paused:true});const host=new SerialHost(new HdsiApp(d),{timers:false});await host.start();
 const all=d.storage.all.bind(d.storage);d.storage.all=((table:any)=>{if(['turns','messages','chat_episodes'].includes(table))throw Error('full history decode '+table);return all(table);}) as any;
 const parse=vi.spyOn(JSON,'parse');await host.acceptInput({id:'i',receivedAt:NOW,content:'新消息'});costs.push(parse.mock.calls.length);parse.mockRestore();expect(d.storage.read('messages','i')?.content).toBe('新消息');await host.stop();d.storage.close();}expect(new Set(costs).size).toBe(1);
});
