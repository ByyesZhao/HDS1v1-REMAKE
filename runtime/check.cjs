const {createRequire}=require('node:module');
const {resolve,isAbsolute,dirname,join}=require('node:path');
const fs=require('node:fs');
function enabledPuppeteer(tree){if(!tree||typeof tree!=='object')return false;for(const [name,value] of Object.entries(tree)){if(name.startsWith('~')||value===false)continue;if(name==='puppeteer'||name.startsWith('puppeteer:'))return true;if((name==='plugins'||name.startsWith('group:'))&&enabledPuppeteer(value))return true;}return false;}
function checkRuntime(paths={},dependencies={}) {
 const runtimeRequire=dependencies.runtimeRequire||createRequire(resolve(__dirname,'package.json'));
 const projectRequire=dependencies.projectRequire||createRequire(resolve(__dirname,'../package.json'));
 const exists=dependencies.existsSync||fs.existsSync,log=dependencies.log||console.log;
 for(const key of ['configPath','databasePath','koishiConfigPath'])if(paths[key]&&!isAbsolute(paths[key]))throw Error(key+' must be an absolute path');
 const configPath=paths.configPath||resolve(__dirname,'../config.local.json'),databasePath=paths.databasePath||resolve(__dirname,'data/hdsi-remake.sqlite');
 if(paths.configPath&&!exists(configPath))throw Error('configuration not found: '+configPath);
 if(paths.databasePath&&!exists(databasePath))throw Error('database not found: '+databasePath);
 for(const name of ['koishi','koishi-plugin-adapter-onebot','koishi-plugin-hdsi-remake','@koishijs/plugin-console']){
  const entry=runtimeRequire.resolve(name),plugin=runtimeRequire(name);
  if(name==='koishi-plugin-hdsi-remake'&&(plugin.name!=='hdsi-remake'||typeof plugin.apply!=='function'))throw Error('plugin entry is invalid');
  log(name+': '+entry);
 }
 if(!exists(configPath)){log('Runtime loading verified; no story configuration.');return;}
 const {loadSettings,connectionFor,modelRoles}=projectRequire('./lib/settings');
 const settings=loadSettings(configPath);modelRoles.forEach(role=>connectionFor(settings,role));
 if(settings.visualInput.enabled)connectionFor(settings,'incoming_image');
 if(settings.webSearch.enabled){if(settings.webSearch.provider!=='browser')throw Error('web search enabled but provider not configured');try{runtimeRequire.resolve('koishi-plugin-puppeteer');}catch{throw Error('install koishi-plugin-puppeteer in the selected runtime before enabling browser search');}const koishiPath=paths.koishiConfigPath||resolve(__dirname,'koishi.yml');if(!exists(koishiPath))throw Error('Koishi configuration not found: '+koishiPath);const yaml=runtimeRequire('yaml').parse(fs.readFileSync(koishiPath,'utf8'));if(!enabledPuppeteer(yaml.plugins))throw Error('enable Puppeteer in the selected Koishi configuration: '+koishiPath);}
 if(!process.env[settings.memoryEmbedding.apiKeyEnv])throw Error('memory embedding local key is missing');
 const {Storage}=projectRequire('./lib/storage');
 if(exists(databasePath)){
  const {inspectSharedUpgrade}=projectRequire('./lib/deployment/shared-upgrade');
  if(inspectSharedUpgrade(databasePath).version!==1)throw Error('Stop HDSI and run shared:migrate -- --database <path> --check before startup');
  const {inspectDialogueUpgrade}=projectRequire('./lib/deployment/dialogue-upgrade');
  const window=inspectDialogueUpgrade(databasePath,{targetVersion:2,idleMinutes:settings.memory.contextLimits.dialogueIdleMinutes,recentSegments:settings.memory.contextLimits.recentDialogueSegments});
  if(window.version!==2||!window.canApply)throw Error('Stop HDSI and run dialogue:migrate -- --database <path> --config <json> --check before startup');
  const db=new Storage(databasePath,{readOnly:true});try{
   if(db.get('memory_schema_version')!==3)throw Error('Stop HDSI and run memory:migrate -- --stopped before startup');
   const {IncomingMediaStore}=projectRequire('./lib/input-media/store');
   // Old readonly libraries with no image tables are supported; constructors perform no DDL.
   const media=new IncomingMediaStore(db);media.readonlyCheck?.();
   if(settings.stickersEnabled){const {StickerLibrary,HttpEmbeddingProvider}=projectRequire('./lib/output/stickers');const e=settings.embedding;
    if(!e||!process.env[e.apiKeyEnv])throw Error('embedding configuration or local key is missing');
    new StickerLibrary(db,new HttpEmbeddingProvider(e.model,e.baseUrl,process.env[e.apiKeyEnv],fetch,e.dimensions)).checkReady();log(db.all('stickers').length+' stickers ready.');
   }
  }finally{db.close();}
 }else if(settings.stickersEnabled)throw Error('import the sticker catalog before startup: '+databasePath);
 log('Specified configuration and database checks verified; no network requests made.');
}
module.exports={checkRuntime,enabledPuppeteer};
if(require.main===module){
 const args=process.argv.slice(2),paths={};for(let i=0;i<args.length;i+=2){const map={'--config':'configPath','--database':'databasePath','--koishi-config':'koishiConfigPath'};if(!map[args[i]]||!args[i+1])throw Error('invalid check argument: '+args[i]);paths[map[args[i]]]=args[i+1];}
 checkRuntime(paths);
}
