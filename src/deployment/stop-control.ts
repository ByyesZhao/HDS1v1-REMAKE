import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,rename,readFile,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import type {AddressInfo} from 'node:net';
import type {Context} from 'koishi';
export interface StopControl {close():Promise<void>}
/** Local explicit stop entry. No cancellation or deadline is added by shutdown. */
export async function startStopControl(file:string,onStop:()=>Promise<void>,options:{exit?:()=>void;log?:(message:string)=>void}={}):Promise<StopControl>{
 const token=randomUUID();let stopping:Promise<void>|null=null,closing:Promise<void>|null=null,exiting=false;
 const server=createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!=='/stop'){res.writeHead(404);res.end();return;}
  if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(403);res.end();return;}
  res.setHeader('content-type','application/json');res.setHeader('connection','close');
  try{
   if(stopping)options.log?.('停止流程已在进行，继续等待当前工作。');
   stopping??=Promise.resolve().then(()=>{options.log?.('收到停止请求：停止新输入和新任务，等待当前故事轮、导演及后台工作保存。');return onStop();}).then(()=>{
    // Exit belongs to completed work, even if the requesting window disconnects.
    if(!exiting){exiting=true;setImmediate(()=>{void close().finally(()=>{options.log?.('当前工作已保存，HDSI停止完成。');(options.exit??(()=>process.exit(0)))();});});}
   });
   await stopping;
   res.end(JSON.stringify({stopped:true}));
  }catch{res.writeHead(500);res.end(JSON.stringify({stopped:false,error:'HDSI停止失败，请查看控制台；没有强制终止进程。'}));}
 });
 server.requestTimeout=0;server.timeout=0;
 await new Promise<void>((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',()=>{server.off('error',fail);ok();});});
 const descriptor={pid:process.pid,port:(server.address() as AddressInfo).port,token};
 const close=()=>closing??=(async()=>{
  await new Promise<void>((ok,fail)=>server.close(error=>error?fail(error):ok()));
  try{const current=JSON.parse(await readFile(file,'utf8'));if(current.token===token)await unlink(file);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 })();
 try{await mkdir(dirname(file),{recursive:true});const tmp=file+'.'+token+'.tmp';await writeFile(tmp,JSON.stringify(descriptor),'utf8');await rename(tmp,file);}catch(error){await close();throw error;}
 return {close};
}
export function installStopControl(ctx:Context,shutdown:()=>Promise<void>):void{
 let control:Promise<StopControl>|null=null,shutdownOnce:Promise<void>|null=null;
 const stop=()=>shutdownOnce??=Promise.resolve().then(shutdown),close=async()=>{if(control)await (await control).close();};
 ctx.on('ready',async()=>{control=startStopControl(join(ctx.baseDir??process.cwd(),'hdsi-control','stop.json'),stop,{log:m=>ctx.logger('hdsi-stop').info(m)});await control;});
 ctx.on('exit' as any,async()=>{await stop();await close();});
 ctx.on('dispose',close);
}
