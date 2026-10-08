import {validatePromptQuality} from '../src/deployment/prompt-quality-acceptance';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {validatePromptContext} from '../src/deployment/prompt-context-acceptance';
import {loadSettings,appConfig,connectionFor} from '../src/settings';
async function main(){const args=process.argv.slice(2),value=(flag:string)=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
 const configPath=value('--config');if(args.includes('--online')&&!configPath)throw Error('--online requires --config');
 const settings=configPath?loadSettings(resolve(configPath)):undefined;
 const report=(args.includes('--quality-only')||args.includes('--expression-only'))?{networkRequests:0,scenarios:[]}:await validatePromptContext({config:settings?appConfig(settings):undefined,recordResults:args.includes('--quality'),connectionFor:args.includes('--online')?task=>connectionFor(settings!,task):undefined});
 const output=resolve(value('--report')??'runtime/data/prompt-context-acceptance.json');mkdirSync(dirname(output),{recursive:true});const quality=(args.includes('--quality')||args.includes('--quality-only')||args.includes('--expression-only'))?await validatePromptQuality({expressionOnly:args.includes('--expression-only'),config:settings?appConfig(settings):undefined,connectionFor:args.includes('--online')?task=>connectionFor(settings!,task):undefined}):undefined;writeFileSync(output,JSON.stringify({...report,...(quality?{quality}:{})},null,2));console.log(JSON.stringify({report:output,networkRequests:report.networkRequests+(quality?.networkRequests??0),scenarios:report.scenarios.map(s=>({name:s.name,done:s.done,requests:s.calls.length}))}));}
main().catch(error=>{console.error(error instanceof Error?error.message:'validation failed');process.exitCode=1;});
