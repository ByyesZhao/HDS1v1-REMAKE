const { Context } = require('koishi');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { resolve, join, sep } = require('node:path');
const { tmpdir } = require('node:os');
const plugin = require('../lib/index.js');

async function main() {
  const workspace = mkdtempSync(join(tmpdir(), 'hdsi-plugin-smoke-'));
  const settingsPath = join(workspace, 'story.json');
  const sample=JSON.parse(readFileSync(resolve(__dirname,'../examples/story.sample.json'),'utf8'));
  sample.initialDetails=[{key:'phone',value:'offline phone fixture',aliases:['手机']}];
  writeFileSync(settingsPath,JSON.stringify(sample));
  const oldKey = process.env.DEEPSEEK_API_KEY, oldEmbeddingKey=process.env.QWEN_API_KEY, oldFetch = global.fetch;
  process.env.DEEPSEEK_API_KEY = 'offline-smoke-key';
  process.env.QWEN_API_KEY = 'offline-smoke-embedding';
  let requests = 0,embeddingRequests=0;
  global.fetch = async (url,init) => {
    if(String(url).endsWith('/embeddings')){embeddingRequests++;return new Response(JSON.stringify({data:[{embedding:Array.from({length:1024},(_,i)=>i===0?1:0)}]}));}
    requests++;
    const input=JSON.parse(JSON.parse(init.body).messages[1].content).input,stage=input.stage;
    const owner=stage==='school_campus'?'campus':'group';
    const result=stage==='world'?{changes:[]}:stage==='school_week'?{stage,instanceChanges:[],noticeCandidates:[],weekChanges:[]}:{stage,planChanges:[{action:'create',clientRef:owner,plan:{owner,kind:owner==='campus'?'semester':'group',title:'offline plan',startsOn:'2026-09-01',endsOn:null,summary:'offline',status:'active'}}],itemChanges:[]};
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }));
  };
  const ctx = new Context(); ctx.baseDir = workspace;
  try {
    ctx.plugin(plugin, { botId: '1000000000', userId: '1000000001', databasePath: 'offline.sqlite', storyConfigPath: settingsPath });
    await ctx.start();
    for(let i=0;i<100&&requests<4;i++)await new Promise(resolve=>setImmediate(resolve));
    if (requests !== 4) throw new Error(`expected four daily environment steps, received ${requests}`);
    if (!ctx.$commander.get('hdsi.status')) throw new Error('HDSI command registration failed');
    const {DatabaseSync}=require('node:sqlite'),inspect=new DatabaseSync(join(workspace,'offline.sqlite'),{readOnly:true});
    try{const row=JSON.parse(inspect.prepare('SELECT data FROM details WHERE id=?').get('phone').data);if(row.ownerType!=='detail'||row.revision!==1)throw new Error('initial detail did not receive V0.3 owner versions');if(embeddingRequests!==1||inspect.prepare('SELECT count(*) AS n FROM memory_index').get().n!==1)throw new Error('initial detail vector not applied offline');const runtime=JSON.parse(inspect.prepare("SELECT data FROM state WHERE key='runtime'").get().data);if(runtime.sharedActivityVersion!==1||runtime.sharedClock!==null||inspect.prepare('SELECT count(*) AS n FROM control_requests').get().n!==0)throw new Error('shared activity state was not initialized');}finally{inspect.close();}
    const check=new DatabaseSync(join(workspace,'offline.sqlite'),{readOnly:true});try{if(check.prepare("SELECT count(*) AS n FROM environment_steps WHERE json_extract(data,'$.status')='committed'").get().n!==4||check.prepare('SELECT count(*) AS n FROM school_plans').get().n!==2)throw Error('daily chain not committed');}finally{check.close();}
    console.log('Real Koishi context: four committed environment steps, two initial plans, shared version/control table and commands verified offline.');
  } finally {
    await ctx.stop();
    // Cordis stop() launches async disposers without awaiting them; let the host/SQLite disposer finish.
    await new Promise(resolve => setImmediate(resolve));
    global.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = oldKey;
    if(oldEmbeddingKey===undefined)delete process.env.QWEN_API_KEY;else process.env.QWEN_API_KEY=oldEmbeddingKey;
    if (!resolve(workspace).startsWith(resolve(tmpdir()) + sep)) throw new Error('unsafe smoke workspace path');
    rmSync(workspace, { recursive: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
