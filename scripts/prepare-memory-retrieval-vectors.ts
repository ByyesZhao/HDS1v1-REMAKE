import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { HttpEmbeddingProvider } from '../src/embedding';
import { loadLocalCredentials } from '../src/deployment/credentials';
import { loadRetrievalDataset } from './lib/memory-retrieval-evaluation';
import { IncompleteVectorsError, loadRetrievalVectorPack, prepareRetrievalVectorPack } from './lib/memory-retrieval-vectors';
import { assertDistinctRetrievalPaths, writeRetrievalJson } from './lib/retrieval-cli-files';

async function main():Promise<void> {
  const args=process.argv.slice(2),options=new Map<string,string>(),allowed=new Set(['--dataset','--config','--output','--online']);
  for(let i=0;i<args.length;i++){
    const flag=args[i];if(!allowed.has(flag)||options.has(flag))throw Error('invalid or duplicate argument');
    if(flag==='--online'){options.set(flag,'true');continue;}
    const value=args[++i];if(!value||value.startsWith('--'))throw Error('argument requires a value');options.set(flag,value);
  }
  if(['--dataset','--config','--output'].some(flag=>!options.has(flag)))throw Error('required: --dataset <json> --config <json> --output <json>');
  const datasetPath=resolve(options.get('--dataset')!),configPath=resolve(options.get('--config')!),outputPath=resolve(options.get('--output')!);
  assertDistinctRetrievalPaths([datasetPath,configPath,outputPath,datasetPath+'.holdout-used.json']);
  // Read only the explicit memoryEmbedding connection. Never assemble runtime, open its DB, or resolve unrelated settings files.
  let config:unknown;try {config=JSON.parse(readFileSync(configPath,'utf8'));}catch {throw Error('cannot read config JSON');}
  const connection=(config as {memoryEmbedding?:{baseUrl?:unknown;model?:unknown;dimensions?:unknown;apiKeyEnv?:unknown}})?.memoryEmbedding;
  if(!connection||typeof connection.baseUrl!=='string'||typeof connection.model!=='string'||!connection.model||typeof connection.apiKeyEnv!=='string'||!connection.apiKeyEnv||typeof connection.dimensions!=='number'||!Number.isInteger(connection.dimensions)||connection.dimensions<1)throw Error('config requires explicit memoryEmbedding baseUrl, model, dimensions and apiKeyEnv');
  const online=options.has('--online'),environment={...process.env};
  if(online)loadLocalCredentials(join(dirname(configPath),'key.txt'),environment);
  const apiKey=online?environment[connection.apiKeyEnv]:undefined;
  if(online&&!apiKey)throw Error('online collection requires configured embedding credentials');
  const dataset=loadRetrievalDataset(datasetPath),previous=existsSync(outputPath)?loadRetrievalVectorPack(outputPath):undefined;
  const configured=new HttpEmbeddingProvider(connection.model,connection.baseUrl,apiKey??'',fetch,connection.dimensions);
  const plan=await prepareRetrievalVectorPack(dataset,configured,{online:false,previous});
  if(!online){console.log(JSON.stringify({mode:'plan',datasetHash:plan.datasetHash,configSignature:plan.configSignature,status:plan.status,plannedRequests:plan.plannedRequests,collectionNetworkRequests:plan.collectionNetworkRequests,requestsThisRun:0}));return;}
  // Persist a valid empty/resumed pack before the first request; every completed attempt updates this checkpoint.
  writeRetrievalJson(outputPath,plan,!previous);
  const pack=await prepareRetrievalVectorPack(dataset,configured,{online:true,previous:plan,checkpoint:current=>writeRetrievalJson(outputPath,current)});
  writeRetrievalJson(outputPath,pack);
  console.log(JSON.stringify({mode:'collection',datasetHash:pack.datasetHash,configSignature:pack.configSignature,status:pack.status,collectionNetworkRequests:pack.collectionNetworkRequests,requestsThisRun:pack.collectionNetworkRequests-(previous?.collectionNetworkRequests??0),failures:pack.failures,owners:Object.keys(pack.owners).length,queries:Object.keys(pack.queries).length}));
  if(pack.status!=='complete')process.exitCode=1;
}
main().catch(error=>{console.error(error instanceof IncompleteVectorsError?JSON.stringify({status:error.status,issues:error.issues}):error instanceof Error?error.message:'vector preparation failed');process.exitCode=1;});
