const {createHash}=require('node:crypto');
const {resolve,join,dirname}=require('node:path');
const fs=require('node:fs');
// Identifies the observed document-reading activity; not a keyword classifier.
const knownActivity={startsAt:'2026-10-10T14:20:57+08:00',descriptionHash:'d6ca3e0a033b5c24452315e27227a4c1b5fda6d066420cc485c98bc20d952624'};
function activityHash(value){return createHash('sha256').update(value).digest('hex');}
function repairKnownPhoneAccess(storage,{at,stopped=false,apply=false,expectedActivity=knownActivity}){
 if(apply&&!stopped)throw Error('stopped declaration is required');
 if(!Number.isFinite(Date.parse(at)))throw Error('valid at is required');
 const work=()=>{
  if(storage.unfinishedTurn())return {status:'unfinished_turn'};
  const current=storage.character(),a=current.scene.activity;
  if(!a||a.phoneAccess||a.expectedEndAt!==null)return {status:'unchanged'};
  if(current.scene.mode!=='chat'||current.scene.shared)return {status:'scene_changed'};
  if(a.startsAt!==expectedActivity.startsAt||activityHash(a.description)!==expectedActivity.descriptionHash)return {status:'scene_changed'};
  const messages=storage.unreadMessages(),summary={unreadCount:messages.length,activityStart:a.startsAt,activityDescriptionHash:activityHash(a.description)};
  if(!apply)return {status:'eligible',...summary};
  storage.set('character',{...current,scene:{...current.scene,activity:{...a,phoneAccess:true}}});
  if(messages.length){
   const old=storage.all('tasks').find(t=>t.kind==='check_messages'&&t.checkReason==='unread'&&t.status==='pending');
   const id=old?.id??require('node:crypto').randomUUID();
   storage.save('tasks',id,{...old,id,kind:'check_messages',checkReason:'unread',description:'已确认普通专注场景恢复查看后检查待看消息',at:new Date(Date.parse(at)+1000).toISOString(),messageIds:messages.map(m=>m.id),status:'pending'});
  }
  return {status:'applied',...summary};
 };
 return apply?storage.transaction(work):work();
}
function main(args){
 const options={};for(let i=0;i<args.length;i++){const arg=args[i];if(['--stopped','--apply','--check'].includes(arg)){options[arg]=true;continue;}if(!['--database','--report','--backup'].includes(arg)||!args[i+1])throw Error('invalid argument');options[arg]=args[++i];}
 if(!options['--database']||!options['--report'])throw Error('--database and --report are required');
 const database=resolve(options['--database']),report=resolve(options['--report']),apply=!!options['--apply'];
 if(apply&&(!options['--stopped']||!options['--backup']))throw Error('--apply requires --stopped and --backup');
 if(apply&&options['--check'])throw Error('choose --check or --apply');
 const pathKey=value=>process.platform==='win32'?resolve(value).toLowerCase():resolve(value);
 const protectedPaths=['','-wal','-shm'].map(suffix=>database+suffix);
 if(options['--backup'])for(const suffix of ['','-wal','-shm'])protectedPaths.push(join(resolve(options['--backup']),'hdsi-remake.sqlite'+suffix));
 if(protectedPaths.some(value=>pathKey(value)===pathKey(report)))throw Error('report must not overwrite database or backup files');
 const {Storage}=require(resolve(__dirname,'../../../../lib/storage'));
 let db=new Storage(database,{readOnly:true}),snapshot;
 try{snapshot=repairKnownPhoneAccess(db,{at:new Date().toISOString()});}finally{db.close();}
 let backup=null,result=snapshot;
 if(apply&&snapshot.status==='eligible'){
  backup=resolve(options['--backup']);fs.mkdirSync(backup,{recursive:true});
  for(const suffix of ['','-wal','-shm'])if(fs.existsSync(database+suffix)){const target=join(backup,'hdsi-remake.sqlite'+suffix);fs.copyFileSync(database+suffix,target,fs.constants.COPYFILE_EXCL);}
  db=new Storage(database);try{result=repairKnownPhoneAccess(db,{at:new Date().toISOString(),stopped:true,apply:true});}finally{db.close();}
 }
 fs.mkdirSync(dirname(report),{recursive:true});const output={at:new Date().toISOString(),mode:apply?'apply':'check',...result,backup};fs.writeFileSync(report,JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify(output));
}
module.exports={repairKnownPhoneAccess,knownActivity};
if(require.main===module){try{main(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}}
