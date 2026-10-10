const {readFile}=require('node:fs/promises');
const {join}=require('node:path');
const {request}=require('node:http');
async function requestStop(file=join(__dirname,'hdsi-control','stop.json'),log=console.log){
 let descriptor;try{descriptor=JSON.parse(await readFile(file,'utf8'));}catch{throw Error('HDSI is not running, or its stop entry is not ready.');}
 log('Stop requested. Waiting for current story/director/background work; keep the HDSI console open.');
 const result=await new Promise((resolve,reject)=>{
  const req=request({hostname:'127.0.0.1',port:descriptor.port,path:'/stop',method:'POST',headers:{authorization:`Bearer ${descriptor.token}`,connection:'close'}},res=>{
   let body='';res.setEncoding('utf8');res.on('data',part=>body+=part);res.on('error',reject);res.on('end',()=>{try{const data=JSON.parse(body);if(res.statusCode!==200||!data.stopped)reject(Error(data.error||'HDSI stop failed; check its console.'));else resolve(data);}catch(error){reject(error);}});
  });
  req.on('error',()=>reject(Error('Cannot contact HDSI stop entry. No process was force-killed.')));req.end();
 });
 log('Current work saved. HDSI stopped.');return result;
}
module.exports={requestStop};
if(require.main===module)requestStop().catch(error=>{console.error(error.message);process.exitCode=1;});
