const assert=require('node:assert/strict');
const {captureQueries,plans}=require('./query-probe.cjs');
const {Storage}=require('../lib/storage'),{MemoryStore}=require('../lib/memory/store'),{MemoryCapacity}=require('../lib/memory/capacity'),{MemoryCleanup}=require('../lib/memory/cleanup'),{defaultMemoryCapacity}=require('../lib/memory/types'),{WebSearchStore}=require('../lib/web/store'),{initialCharacter}=require('../lib/config');
const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--output')throw Error('Use --output <json>; synthetic memory databases only');
const at='2026-10-08T02:00:00Z',results=[];
for(const H of [1000,10000,50000]){
 const s=new Storage(':memory:');try{s.transaction(()=>{for(let i=0;i<H+4;i++){const id='e'+i,t=new Date(Date.UTC(2026,0,1)+i*1200000).toISOString();s.save('chat_episodes',id,{id,openedAt:t,lastInteractionAt:t,status:'closed',closedAt:t,closeReason:'idle'});for(let j=0;j<(i>=H?41:1);j++){const m=id+':'+j;s.save('messages',m,{id:m,content:'完整正文'+j,receivedAt:t,direction:'outgoing',seenTurnId:null,turnId:null,outboxSeq:null,batchId:null,platformMessageIds:[],chatEpisodeId:id,sharedActivityId:null});}}});
 const observed=captureQueries(s,()=>s.recentChatSnapshot({eligibility:'ordinary_narrative',count:4,visibleIds:[]}));assert.equal(observed.value.messages.length,164);assert.equal(observed.value.episodes.length,4);assert.equal(observed.queries.reduce((n,q)=>n+q.jsonRows,0),168);
 const rank=observed.queries[0],ops=s.prepare('EXPLAIN '+rank.sql).all(...rank.args),messageRoot=s.prepare("SELECT rootpage FROM sqlite_master WHERE name='messages'").get().rootpage,messageCursors=ops.filter(o=>o.opcode==='OpenRead'&&o.p2===messageRoot).map(o=>o.p1),bodyColumns=ops.filter(o=>o.opcode==='Column'&&messageCursors.includes(o.p1)&&o.p2===1);assert.equal(bodyColumns.length,0);
 const samples=[];for(let i=0;i<6;i++){const start=performance.now();s.recentChatSnapshot({eligibility:'ordinary_narrative',count:4,visibleIds:[]});samples.push(performance.now()-start);}
 results.push({kind:'chatWindow',H,selectedEpisodes:4,fullMessages:164,queries:observed.queries,plans:plans(s,observed.queries),rankMessageBodyColumnOperations:bodyColumns.length,firstMs:samples[0],hotMs:samples.slice(1),medianMs:samples.slice(1).sort((a,b)=>a-b)[2]});
 }finally{s.close();}
}
for(const H of [0,1000,5000]){
 const s=new Storage(':memory:');try{s.set('character',initialCharacter(at));const store=new MemoryStore(s);s.set('memory_schema_version',3);new WebSearchStore(s);
 s.prepare('CREATE TABLE audit(tableName TEXT)').run();for(const table of ['memory_index_jobs','memory_maintenance_jobs','post_jobs','web_sessions'])s.prepare("CREATE TRIGGER audit_"+table+" AFTER UPDATE ON "+table+" BEGIN INSERT INTO audit VALUES('"+table+"'); END").run();
 s.transaction(()=>{for(let i=0;i<H;i++){store.saveJob('memory_index_jobs',{id:'i'+i,status:'done',text:'',createdAt:at});store.saveJob('memory_maintenance_jobs',{id:'m'+i,status:'done',snapshot:[],readSet:[],result:null,createdAt:at});s.save('turns','t'+i,{id:'t'+i,done:true});s.save('post_jobs','t'+i,{turnId:'t'+i,result:null});s.prepare('INSERT INTO web_sessions(id,data) VALUES(?,?)').run('w'+i,JSON.stringify({ref:{ownerType:'turn',ownerId:'t'+i},checkpoint:null}));}for(let i=0;i<10;i++)store.saveOwner(store.makeOwner({ownerType:'long',ownerId:'delete'+i},{content:'合成删除',status:'discarded'},at));});
 const cleanup=new MemoryCleanup(store,new MemoryCapacity(store,defaultMemoryCapacity)),start=performance.now();for(let i=0;i<10;i++)assert.equal(cleanup.applyOne(at),'applied');const actualUpdates=s.prepare('SELECT tableName,count(*) n FROM audit GROUP BY tableName').all();assert.equal(actualUpdates.length,0);assert.equal(store.allOwners().length,0);
 results.push({kind:'cleanup',H,K:10,actualHistoricalUpdates:actualUpdates,deletedOwners:10,elapsedMs:performance.now()-start});
 }finally{s.close();}
}
require('node:fs').writeFileSync(args[1],JSON.stringify({node:process.version,scope:'offline synthetic databases; counts and native plans',results},null,2));
process.stdout.write('Window and cleanup assertions passed: '+results.length+' samples\n');
