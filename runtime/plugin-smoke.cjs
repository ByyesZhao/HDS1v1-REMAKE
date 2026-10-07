const { Context } = require('koishi');
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs');
const { resolve, join, sep } = require('node:path');
const { tmpdir } = require('node:os');
const plugin = require('koishi-plugin-hdsi-remake');

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
  global.fetch = async (url) => {
    if(String(url).endsWith('/embeddings')){embeddingRequests++;return new Response(JSON.stringify({data:[{embedding:Array.from({length:1024},(_,i)=>i===0?1:0)}]}));}
    requests++;return new Response(JSON.stringify({ choices: [{ message: { content: '{"changes":[]}' } }] }));
  };
  const ctx = new Context(); ctx.baseDir = workspace;
  try {
    ctx.plugin(plugin, { botId: '1000000000', userId: '1000000001', databasePath: 'offline.sqlite', storyConfigPath: settingsPath });
    await ctx.start();
    await new Promise(resolve=>setImmediate(resolve));
    if (requests !== 2) throw new Error(`expected world and school calls, received ${requests}`);
    if (!ctx.$commander.get('hdsi.status')) throw new Error('HDSI command registration failed');
    const {DatabaseSync}=require('node:sqlite'),inspect=new DatabaseSync(join(workspace,'offline.sqlite'),{readOnly:true});
    try{const row=JSON.parse(inspect.prepare('SELECT data FROM details WHERE id=?').get('phone').data);if(row.ownerType!=='detail'||row.revision!==1)throw new Error('initial detail did not receive V0.3 owner versions');if(embeddingRequests!==1||inspect.prepare('SELECT count(*) AS n FROM memory_index').get().n!==1)throw new Error('initial detail vector not applied offline');}finally{inspect.close();}
    console.log('Real Koishi context: plugin registration, initial environment turns, and commands verified offline.');
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
