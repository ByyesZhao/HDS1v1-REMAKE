// Read-only comparison against this batch's stopped backup. Emits fingerprints, never row bodies.
const {resolve,join}=require('node:path');
const fs=require('node:fs');
const {createHash}=require('node:crypto');
const root=resolve(__dirname,'../../../..');
const {Storage}=require(join(root,'lib/storage'));
const apply=JSON.parse(fs.readFileSync(join(__dirname,'evidence/formal-apply.json'),'utf8'));
if(apply.status!=='applied'||!apply.backup)throw Error('no successful stopped deployment report');
const oldDb=new Storage(join(apply.backup,'hdsi-remake.sqlite'),{readOnly:true});
const newDb=new Storage(join(root,'runtime/data/hdsi-remake.sqlite'),{readOnly:true});
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const rows=(db,name)=>db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
try{
 const names=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
 const tables=names(oldDb);if(hash(tables)!==hash(names(newDb)))throw Error('table list changed');
 const unchanged={};for(const name of tables)if(name!=='state'&&name!=='tasks'){const before=rows(oldDb,name),after=rows(newDb,name);if(hash(before)!==hash(after))throw Error('unexpected change in '+name);unchanged[name]={count:after.length,sha256:hash(after)};}
 const stateBefore=rows(oldDb,'state').filter(r=>r.key!=='character'),stateAfter=rows(newDb,'state').filter(r=>r.key!=='character');
 if(hash(stateBefore)!==hash(stateAfter))throw Error('runtime or other state changed');
 const expected=oldDb.character();expected.scene.activity.phoneAccess=true;
 if(hash(expected)!==hash(newDb.character()))throw Error('character changed beyond phoneAccess');
 const beforeTasks=rows(oldDb,'tasks'),afterTasks=rows(newDb,'tasks'),changed=afterTasks.filter(r=>!beforeTasks.some(o=>o.id===r.id&&o.data===r.data));
 if(beforeTasks.some(r=>!afterTasks.some(n=>n.id===r.id))||changed.length!==1)throw Error('unexpected task changes');
 const check=JSON.parse(changed[0].data),unread=newDb.unreadMessages();
 if(check.kind!=='check_messages'||check.checkReason!=='unread'||check.status!=='pending'||hash([...check.messageIds].sort())!==hash(unread.map(m=>m.id).sort()))throw Error('unread check mismatch');
 const summary={at:new Date().toISOString(),characterOnlyPhoneAccessChanged:true,otherStateUnchanged:true,tableListUnchanged:true,unchangedTables:unchanged,changedTaskCount:1,unreadCount:unread.length,checkScheduled:true,stickerCount:newDb.all('stickers').length,serviceRestarted:false,qqAcceptance:'pending_user_restart'};
 fs.writeFileSync(join(__dirname,'evidence/formal-delta-verification.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({characterOnlyPhoneAccessChanged:true,otherStateUnchanged:true,unchangedTableCount:Object.keys(unchanged).length,changedTaskCount:1,unreadCount:unread.length,stickerCount:summary.stickerCount}));
}finally{oldDb.close();newDb.close();}
