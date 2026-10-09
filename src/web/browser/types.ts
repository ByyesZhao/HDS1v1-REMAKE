import type {WebSearchProvider} from '../provider';
export type BrowserEngine='bing'|'duckduckgo';
export interface BrowserProviderConfig {engine:BrowserEngine;navigationTimeoutMs:number;maxConcurrentPages:number}
export type BrowserReadRequest={kind:'search';url:string;engine:BrowserEngine}|{kind:'article';url:string};
export interface BrowserPageResult {finalUrl:string;title:string;access:'ok'|'login_wall'|'captcha'|'http_error';search:{state:'results'|'empty'|'unready';links:Array<{url:string;title:string}>;evidence:string|null}|null;main:{text:string;source:'article'|'main'|'readability'}|null}
export interface BrowserPagePort {read(request:BrowserReadRequest,options:{signal:AbortSignal;deadlineAt:number}):Promise<BrowserPageResult>;close():Promise<void>;isClosed?():boolean}
export interface BrowserPort {openPage():Promise<BrowserPagePort>}
export interface ManagedBrowserProvider {provider:WebSearchProvider;stopAccepting(reason?:Error):void;dispose():Promise<void>}
