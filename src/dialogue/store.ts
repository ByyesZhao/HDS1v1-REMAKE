import { Storage } from '../storage';
import type { DialogueEpisode,DialogueActivityLink,ChatEpisode } from './types';
export class DialogueStore {
 constructor(readonly storage:Storage){}
 episodes():DialogueEpisode[]{return this.storage.all('dialogue_episodes');}
 episode(id:string):DialogueEpisode|null{return this.storage.read('dialogue_episodes',id);}
 saveEpisode(row:DialogueEpisode):void{this.storage.save('dialogue_episodes',row.id,row);}
 links():DialogueActivityLink[]{return this.storage.all('dialogue_activity_links');}
 link(id:string):DialogueActivityLink|null{return this.storage.read('dialogue_activity_links',id);}
 saveLink(row:DialogueActivityLink):void{this.storage.save('dialogue_activity_links',row.id,row);}
 chatEpisodes():ChatEpisode[]{return this.storage.all('chat_episodes');}
 openChatEpisodes():ChatEpisode[]{return this.storage.prepare("SELECT data FROM chat_episodes WHERE json_extract(data,'$.status')='open' ORDER BY rowid").all().map(r=>JSON.parse(String(r.data)));}
 chatEpisode(id:string):ChatEpisode|null{return this.storage.read('chat_episodes',id);}
 saveChatEpisode(row:ChatEpisode):void{this.storage.save('chat_episodes',row.id,row);}
}
