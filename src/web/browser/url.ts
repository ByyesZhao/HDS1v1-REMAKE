export function normalizePublicUrl(value:string):string|null{
 try{const url=new URL(value),host=url.hostname.toLowerCase();if(!['http:','https:'].includes(url.protocol)||url.username||url.password||host==='localhost'||host.endsWith('.localhost')||host==='[::1]'||/^(127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host))return null;url.hash='';return url.href;}catch{return null;}
}
