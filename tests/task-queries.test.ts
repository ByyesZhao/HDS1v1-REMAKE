import {it,expect} from 'vitest';
import {Storage} from '../src/storage';
import {NOW} from './helpers';
it('pending query uses the status index and preserves row order without changing history',()=>{
 const storage=new Storage(':memory:');
 try {
  storage.transaction(()=>{for(let i=0;i<10000;i++)storage.save('tasks','history-'+i,{id:'history-'+i,kind:'appointment',at:NOW,description:'history',status:i%2?'completed':'cancelled'});});
  for(const [id,at] of [['later','2026-10-07T03:00:00Z'],['same-offset','2026-10-07T10:00:00+08:00'],['same-utc','2026-10-07T02:00:00Z']])storage.save('tasks',id,{id,kind:'appointment',at,description:id,status:'pending'});
  const history=storage.all('tasks');
  expect(storage.pendingTasks()).toEqual(history.filter(t=>t.status==='pending'));
  expect(storage.pendingTasks().map(t=>t.id)).toEqual(['later','same-offset','same-utc']);
  expect(storage.all('tasks')).toEqual(history);
  const plan=storage.prepare("EXPLAIN QUERY PLAN SELECT data FROM tasks WHERE json_extract(data,'$.status')='pending' ORDER BY rowid").all();
  expect(plan.some(r=>/SEARCH.*task_due/i.test(String(r.detail)))).toBe(true);
 }finally{storage.close();}
});
it('activity scene query includes terminal matching scenes and excludes appointments and other activities',()=>{
 const storage=new Storage(':memory:');
 try {
  for(const [id,kind,sharedActivityId,status] of [
   ['scene:a','scene_step','different','completed'],['alias','scene_step','a','cancelled'],['appointment','appointment','a','pending'],['other','scene_step','b','pending'],['pending','scene_step','a','pending'],
  ] as const)storage.save('tasks',id,{id,kind,sharedActivityId,status,at:NOW,description:id});
  expect(storage.sceneTasksForActivity('a').map(t=>[t.id,t.status])).toEqual([['scene:a','completed'],['alias','cancelled'],['pending','pending']]);
 }finally{storage.close();}
});
