import type {Clock} from '../types';
import type {StorySettings} from '../settings';
import type {Storage} from '../storage';
import type {WebSearchProvider} from '../web/provider';
import {WebSearchStore} from '../web/store';
import {WebSearchService} from '../web/service';
export function assembleWeb(storage:Storage,settings:StorySettings,clock:Clock,provider?:WebSearchProvider){return new WebSearchService(new WebSearchStore(storage),provider,clock,settings.webSearch);}
