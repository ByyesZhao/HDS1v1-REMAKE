export type RequestFailureReason='network_error'|'body_read_failed'|'empty_body'|'invalid_json'|'http_error'|'provider_error'|'invalid_envelope'|'missing_choices'|'empty_choices'|'missing_message'|'missing_content'|'non_string_content';
export interface ModelRequestDiagnostic {
 phase:'request'|'body'|'json'|'http'|'envelope';reason:RequestFailureReason;elapsedMs:number;
 httpStatus?:number;contentType?:string;requestId?:string;responseBytes?:number;networkCode?:string;providerCode?:string;
 choiceCount?:number;contentValueType?:string;finishReason?:string;
}
const networkCodes=new Set(['UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET','ECONNRESET','ETIMEDOUT','ECONNREFUSED','EAI_AGAIN','ENOTFOUND','EPIPE','ERR_STREAM_PREMATURE_CLOSE','ABORT_ERR']);
export function requestNetworkCode(error:unknown):string|undefined {
 let current=error;for(let i=0;i<3&&current&&typeof current==='object';i++){
  const value=current as {code?:unknown;cause?:unknown};if(typeof value.code==='string'&&networkCodes.has(value.code))return value.code;current=value.cause;
 }return undefined;
}
export function requestResponseMetadata(response:Response,apiKey:string):Pick<ModelRequestDiagnostic,'httpStatus'|'contentType'|'requestId'> {
 const mime=response.headers.get('content-type')?.match(/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+/)?.[0];
 const contentType=mime&&!(apiKey&&mime.includes(apiKey))?mime.toLowerCase():undefined;
 const candidate=response.headers.get('x-request-id')??response.headers.get('request-id')??response.headers.get('x-amzn-requestid');
 const requestId=candidate&&/^[\w.:-]{1,128}$/.test(candidate)&&!/(?:sk-|bearer|basic|password|secret|token|api.?key)/i.test(candidate)&&!(apiKey&&candidate.includes(apiKey))?candidate:undefined;
 return {httpStatus:response.status,...(contentType?{contentType}:{}),...(requestId?{requestId}:{})};
}
const labels:Record<RequestFailureReason,string>={network_error:'接口连接异常',body_read_failed:'接口响应体读取失败',empty_body:'接口返回空响应体',invalid_json:'接口响应不是合法JSON',http_error:'接口HTTP错误',provider_error:'接口返回错误对象',invalid_envelope:'接口响应根结构异常',missing_choices:'接口响应缺少有效choices',empty_choices:'接口响应choices为空',missing_message:'接口响应缺少message',missing_content:'接口响应缺少content',non_string_content:'接口响应content类型异常'};
export function requestDiagnosticSummary(d:ModelRequestDiagnostic):string {
 return `${labels[d.reason]} [${d.reason}]${d.httpStatus===undefined?'':`；HTTP ${d.httpStatus}`}；耗时${d.elapsedMs}ms${d.networkCode?`；${d.networkCode}`:''}${d.providerCode?`；代码 ${d.providerCode}`:''}${d.finishReason?`；结束原因 ${d.finishReason}`:''}${d.requestId?`；请求ID ${d.requestId}`:''}`;
}
export function requestDiagnosticMessage(task:string,d:ModelRequestDiagnostic):string {
 return `${task}: ${d.reason} (${d.phase}${d.httpStatus===undefined?'':`, HTTP ${d.httpStatus}`}${d.contentType?`, ${d.contentType}`:''}, elapsed ${d.elapsedMs}ms${d.responseBytes===undefined?'':`, bytes ${d.responseBytes}`}${d.networkCode?`, ${d.networkCode}`:''}${d.providerCode?`, code ${d.providerCode}`:''}${d.finishReason?`, finish ${d.finishReason}`:''}${d.requestId?`, request ${d.requestId}`:''})`;
}
