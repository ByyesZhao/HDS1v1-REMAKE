import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';import {resolve,join,isAbsolute} from 'node:path';
import {Storage} from '../src/storage';import {MemoryStore} from '../src/memory/store';import {initialCharacter} from '../src/config';
function hash(path:string){return createHash('sha256').update(readFileSync(path)).digest('hex');}
export function verifyFeatureCheck(root:string){const before=JSON.parse(readFileSync(join(root,'before-check.json'),'utf8'));for(const [file,h] of Object.entries(before.files))if(hash(join(root,file))!==h)throw Error('fixture changed: '+file);return true;}
export function prepareFeatureCheck(mode:'image'|'search',root:string){
 if(!isAbsolute(root))throw Error('output must be absolute');if(existsSync(root)&&readdirSync(root).length)throw Error('output must be empty');

 mkdirSync(root,{recursive:true});const sample=JSON.parse(readFileSync(resolve('examples/story.sample.json'),'utf8'));
 sample.background='合成验收角色，喜欢猫和阅读。';sample.chatExamples='嗯嗯！';sample.initialDetails=[];sample.initialEvents=[];delete sample.backgroundFile;delete sample.backgroundViewsFile;delete sample.backgroundViews;
 delete sample.memory?.calibrationFile;sample.stickersEnabled=false;sample.visualInput={enabled:true};sample.webSearch=mode==='search'?{enabled:true,provider:'browser',browser:{engine:'bing',navigationTimeoutMs:60000,maxConcurrentPages:1}}:{enabled:false};
 for(const c of [...Object.values(sample.models),sample.stickerDescriptionModel,sample.incomingImageModel].filter(Boolean) as any[]){c.apiKeyEnv='HDSI_FEATURE_DEEPSEEK';}
 sample.memoryEmbedding.apiKeyEnv='HDSI_FEATURE_EMBEDDING';if(sample.embedding)sample.embedding.apiKeyEnv='HDSI_FEATURE_EMBEDDING';
 const story=join(root,'story.json'),database=join(root,'story.sqlite'),koishi=join(root,'koishi.yml');
 writeFileSync(story,JSON.stringify(sample,null,2));writeFileSync(koishi,'plugins:\n  hdsi-remake: {}\n'+(mode==='search'?'  puppeteer: {}\n':''));
 const db=new Storage(database);try{db.set('character',initialCharacter('2026-10-09T02:00:00Z'));const memory=new MemoryStore(db);memory.migrate('2026-10-09T02:00:00Z');memory.migrateCapacity('2026-10-09T02:00:00Z');}finally{db.close();}
 writeFileSync(join(root,'no-network.cjs'),"process.env.HDSI_FEATURE_DEEPSEEK='synthetic';process.env.HDSI_FEATURE_EMBEDDING='synthetic';global.fetch=()=>{throw Error('feature check network forbidden');};\n");
 writeFileSync(join(root,'paths.json'),JSON.stringify({configPath:story,databasePath:database,koishiConfigPath:koishi},null,2));
 writeFileSync(join(root,'before-check.json'),JSON.stringify({mode,files:Object.fromEntries(['story.json','story.sqlite','koishi.yml'].map(file=>[file,hash(join(root,file))]))},null,2));return {configPath:story,databasePath:database,koishiConfigPath:koishi};
}
if(process.argv[1]?.includes('prepare-feature-check')){const args=process.argv.slice(2),get=(k:string)=>args[args.indexOf(k)+1];if(args.includes('--verify')){verifyFeatureCheck(get('--verify'));console.log('fixture unchanged');}else{const mode=get('--mode');if(!['image','search'].includes(mode))throw Error('mode must be image|search');console.log(prepareFeatureCheck(mode as any,get('--output')));}}
