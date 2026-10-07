export interface WebSearchProvider {
  signature:string;available?:boolean;
  search(query:string,signal?:AbortSignal):Promise<Array<{url:string;title:string}>>;
  read(url:string,signal?:AbortSignal):Promise<{title:string;body:string}>;
}
export class UnconfiguredWebProvider implements WebSearchProvider {
  readonly signature='unconfigured';readonly available=false;
  async search(_query:string):Promise<Array<{url:string;title:string}>>{throw new Error('web search provider not configured');}
  async read(_url:string):Promise<{title:string;body:string}>{throw new Error('web search provider not configured');}
}
