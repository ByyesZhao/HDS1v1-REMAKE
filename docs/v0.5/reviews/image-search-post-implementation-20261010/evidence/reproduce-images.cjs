// Offline post-delivery review probe. Run from any directory with Node >= 22.13.
// Uses only synthetic messages, mock models, an in-memory DB and a private temp dir.
const {createRequire} = require('node:module');
const {resolve, join, relative, sep} = require('node:path');
const {mkdirSync, mkdtempSync, rmSync, writeFileSync} = require('node:fs');
const root = resolve(__dirname, '../../../../..');
const req = createRequire(join(root, 'package.json'));
req('tsx/cjs');
const {modern} = req('./tests/chat-fixture.ts');
const {saveInput} = req('./tests/helpers.ts');
const {HdsiApp} = req('./src/app.ts');
const {IncomingMediaStore} = req('./src/input-media/store.ts');
const {IncomingMediaService} = req('./src/input-media/service.ts');
const {IncomingAssets, AttachmentResolver} = req('./src/input-media/assets.ts');
const {OneBot} = createRequire(join(root, 'runtime/package.json'))('koishi-plugin-adapter-onebot');
const tempParent = join(root, '.tmp', 'post-implementation-review');
mkdirSync(tempParent, {recursive:true});
const temp = mkdtempSync(join(tempParent, 'images-'));
let fetchCalls = 0;
const noFetch = async () => { fetchCalls++; throw Error('probe forbids network'); };

async function confirmedAfterDisable() {
  const d = modern();
  const store = new IncomingMediaStore(d.storage);
  let service;
  const make = enabled => new IncomingMediaService(store,
    new IncomingAssets(store, join(temp, 'assets'), new AttachmentResolver(noFetch)),
    d.models, {enabled});
  try {
    d.models.outputs.incoming_image = {description:'cat', visibleText:['hello'], possibleTone:null, uncertain:false};
    saveInput(d.storage, 'seen-image', '（图片）');
    store.register([{id:'seen-image:0', messageId:'seen-image', order:0, kind:'image',
      sourceUrl:'data:image/png;base64,iVBORw0KGgoAAAAA'}]);
    service = make(true);
    await new HdsiApp({...d, incomingMedia:service}).runTurn({inputMessageIds:['seen-image'], taskIds:[], triggerKinds:['input']});
    const first = service.readConfirmedForMessages(['seen-image']);
    const callsBefore = d.models.calls.filter(c => c.name === 'incoming_image').length;
    await service.stop();
    service = make(false);
    d.clock.advance(60000);
    d.storage.save('tasks', 'defer', {id:'defer', kind:'check_messages', at:d.clock.now(),
      status:'pending', description:'answer the already seen image', checkReason:'deferred_reply', messageIds:['seen-image']});
    const start = d.models.calls.length;
    await new HdsiApp({...d, incomingMedia:service}).runTurn({inputMessageIds:[], taskIds:['defer'], triggerKinds:['check_messages']});
    const second = d.storage.all('turns').find(t => t.triggerTaskIds.includes('defer'));
    const personal = d.models.calls.slice(start).find(c => c.name === 'personal_chat');
    return {
      firstConfirmed:first.map(e => ({status:e.status, observationRef:e.observationRef, observation:e.observation})),
      confirmedStillPresent:service.readConfirmedForMessages(['seen-image']).length,
      deferredTurnDone:second.done,
      frozenStatus:second.visualContext.entries[0].status,
      personalMessage:personal.input.resources.messages.find(m => m.id === 'seen-image'),
      personalVisualObservations:personal.input.resources.visualObservations,
      extraVisionCalls:d.models.calls.filter(c => c.name === 'incoming_image').length - callsBefore,
    };
  } finally { await service?.stop(); d.storage.close(); }
}

async function unavailableOneBotFile() {
  const d = modern();
  const internal = new OneBot.Internal({logger:{debug(){}}});
  let getImageCalls = 0;
  internal._request = async (action, params) => {
    if(action !== 'get_image' || params.file !== 'expired.image') throw Error('unexpected adapter request');
    getImageCalls++;
    return {retcode:100, data:null};
  };
  const message = await OneBot.adaptMessage({platform:'onebot', config:{advanced:{splitMixedContent:false}}},
    {message_id:1, message:[{type:'image', data:{file:'expired.image'}}], sender:{user_id:2, nickname:'synthetic'}, time:1});
  const {parseIncomingContent} = req('./src/input-media/parse.ts');
  const parsed = parseIncomingContent('unavailable', message.content);
  const store = new IncomingMediaStore(d.storage);
  const assets = new IncomingAssets(store, join(temp, 'unavailable'),
    new AttachmentResolver(noFetch, file => internal.getImage(file)));
  const service = new IncomingMediaService(store, assets, d.models, {enabled:true});
  try {
    saveInput(d.storage, 'unavailable', parsed.content);
    store.register(parsed.attachments);
    let error;
    try { await new HdsiApp({...d, incomingMedia:service}).runTurn({inputMessageIds:['unavailable'], taskIds:[], triggerKinds:['input']}); }
    catch(e) { error = {name:e.constructor.name, message:e.message}; }
    const turn = d.storage.all('turns')[0];
    return {adapterContent:message.content, error, getImageCalls, paused:d.storage.runtime().paused,
      turnDone:turn.done, terminalEntries:service.readFrozenForTurn(turn.id),
      attachmentStatus:store.forMessages(['unavailable'])[0].downloadStatus,
      modelTasks:d.models.calls.map(c => c.name), errorNotices:d.sender.errors};
  } finally { await service.stop(); d.storage.close(); }
}

(async () => {
  try {
    const result = {baseline:'2a2e77e', fixture:'synthetic, dialogue protocol 2',
      confirmedAfterDisable:await confirmedAfterDisable(), unavailableOneBotFile:await unavailableOneBotFile(), fetchCalls};
    if(process.argv[2]) writeFileSync(resolve(process.argv[2]), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    const child = relative(tempParent, temp);
    if(!child || child.startsWith('..' + sep) || child === '..' || resolve(temp) === resolve(tempParent)) throw Error('unsafe probe cleanup');
    rmSync(temp, {recursive:true, force:true});
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
