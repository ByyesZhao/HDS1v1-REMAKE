const bytes=value=>typeof value==='string'?Buffer.byteLength(value):0;
exports.captureQueries=function(storage,fn){
 const db=storage.db,original=db.prepare,queries=[];
 db.prepare=function(sql){const statement=original.call(this,sql);return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);if(!['all','get','run'].includes(key))return typeof value==='function'?value.bind(target):value;return (...args)=>{const result=value.apply(target,args),rows=key==='all'?result:key==='get'&&result?[result]:[];queries.push({sql,args,method:key,rows:rows.length,jsonRows:rows.filter(r=>typeof r.data==='string'||typeof r.snapshot==='string').length,jsonBytes:rows.reduce((n,r)=>n+bytes(r.data)+bytes(r.snapshot),0),writes:key==='run'?Number(result.changes):0});return result;};}});};
 try{return {value:fn(),queries};}finally{db.prepare=original;}
};
exports.plans=function(storage,queries){return queries.filter(q=>q.sql.trim().toUpperCase().startsWith('SELECT')||q.sql.trim().toUpperCase().startsWith('WITH')).map(q=>({sql:q.sql,args:q.args,plan:storage.prepare('EXPLAIN QUERY PLAN '+q.sql).all(...q.args)}));};
