import {join} from 'node:path';import {writeFile} from 'node:fs/promises';
import {asyncFixture} from '../environment-async-fixture';import {initialCharacter} from '../../src/config';import {NOW} from '../helpers';import {Storage} from '../../src/storage';
import {HdsiApp} from '../../src/app';import {SerialHost} from '../../src/host/runtime';import {startStopControl} from '../../src/deployment/stop-control';
async function main(){const root=process.argv[2],storage=new Storage(join(root,'story.sqlite'));storage.set('character',initialCharacter(NOW));const {d,step}=asyncFixture('world',storage);let release!:(r:any)=>void,signal!:AbortSignal;
 d.generateEnvironment=async(_input,options)=>{signal=options!.signal!;return new Promise(r=>release=r);};const host=new SerialHost(new HdsiApp(d),{timers:false});await host.start();
 await startStopControl(join(root,'control.json'),async()=>{setTimeout(()=>release({stage:'world',changes:[]}),100);await host.stop({graceful:true});const result={status:d.environmentStore.step(step.id)!.status,aborted:signal.aborted,attempted:d.environmentStore.steps(step.batchId).filter(s=>s.attempt>0).length};storage.close();await writeFile(join(root,'result.json'),JSON.stringify(result));});
}void main().catch(error=>{console.error(error);process.exit(1);});
