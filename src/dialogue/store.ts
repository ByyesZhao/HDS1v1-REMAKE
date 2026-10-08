import { Storage } from '../storage';
import type { DialogueEpisode,DialogueActivityLink } from './types';
export class DialogueStore {
 constructor(readonly storage:Storage){}
 episodes():DialogueEpisode[]{return this.storage.all('dialogue_episodes');}
 episode(id:string):DialogueEpisode|null{return this.storage.read('dialogue_episodes',id);}
 saveEpisode(row:DialogueEpisode):void{this.storage.save('dialogue_episodes',row.id,row);}
 links():DialogueActivityLink[]{return this.storage.all('dialogue_activity_links');}
 link(id:string):DialogueActivityLink|null{return this.storage.read('dialogue_activity_links',id);}
 saveLink(row:DialogueActivityLink):void{this.storage.save('dialogue_activity_links',row.id,row);}
}
