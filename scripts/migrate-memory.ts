import { resolve } from 'node:path';
import { Storage } from '../src/storage';
import { MemoryStore } from '../src/memory/store';

if(!process.argv.includes('--stopped'))throw new Error('Stop HDSI first, then supply --stopped to migrate the selected database.');
const path=process.argv.slice(2).find(a=>!a.startsWith('--'))??'runtime/data/hdsi-remake.sqlite';
const storage=new Storage(resolve(path));
try {const store=new MemoryStore(storage);store.migrate(new Date().toISOString());console.log(`Memory schema ${store.schemaVersion()}; migration completed.`);} finally {storage.close();}
