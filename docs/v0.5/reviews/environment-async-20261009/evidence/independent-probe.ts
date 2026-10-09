import {asyncFixture} from '../../../../../tests/environment-async-fixture';
import {NOW} from '../../../../../tests/helpers';
import {MemoryStore} from '../../../../../src/memory/store';
import {MemoryRetrieval} from '../../../../../src/memory/retrieval';
import {freezeEnvironmentSnapshot,lookupFrozenEnvironment,lookupBasisCurrent} from '../../../../../src/environment/snapshot';
async function main(){
 const {d,step}=asyncFixture();const store=new MemoryStore(d.storage);store.migrate(NOW);
 d.storage.save('experiences','experience-source',{id:'experience-source',description:'synthetic'} as any);
 const ids=[];for(let i=0;i<100;i++){const id='old-'+i;ids.push(id);d.storage.save('messages',id,{id,content:'X'.repeat(10000),direction:'outgoing',receivedAt:'2025-01-01T00:00:00Z',platformMessageIds:[],seenTurnId:null,turnId:null,outboxSeq:null,batchId:null});}
 const row=store.makeOwner({ownerType:'detail',ownerId:'phone'},{key:'phone',value:'A',content:'A',sourceIds:['experience-source',...ids]},NOW);store.saveOwner(row);
 const dep={...d,memoryStore:store,retrieval:new MemoryRetrieval(store)};
 const snapshot=freezeEnvironmentSnapshot(dep,step,NOW);
 const result=await lookupFrozenEnvironment(snapshot,'phone',dep.retrieval);snapshot.usedBasis=result.usedBasis;
 const before=lookupBasisCurrent(dep,snapshot);d.storage.remove('experiences','experience-source');const after=lookupBasisCurrent(dep,snapshot);
 console.log(JSON.stringify({sourceBodyCharacters:snapshot.retrieval.sourceMessages.reduce((n,m)=>n+m.content.length,0),recentMessages:snapshot.retrieval.recent.length,snapshotBytes:Buffer.byteLength(JSON.stringify(snapshot)),usedOwnerCount:result.usedBasis.owners.length,usedMessageCount:result.usedBasis.messageIds.length,basisBeforeSourceDeletion:before,basisAfterSourceDeletion:after},null,2));d.storage.close();
}void main();

