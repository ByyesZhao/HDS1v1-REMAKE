import {setup} from './helpers';
import {ChatEpisodes} from '../src/dialogue/chat-episodes';
import {DialogueStore} from '../src/dialogue/store';
export function modern(){const d=setup();d.storage.set('runtime',{...d.storage.runtime(),dialogueContextVersion:2,activeChatEpisodeId:null});d.storage.save('chat_index_metadata','chat-index',{id:'chat-index',idleMinutes:15});return {...d,chat:new ChatEpisodes(new DialogueStore(d.storage))};}
