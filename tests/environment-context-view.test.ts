import {it,expect} from 'vitest';
import {buildEnvironmentView} from '../src/model/context-views';
const views={version:1 as const,status:'approved' as const,core:'私有背景',style:'口语',world:'某大学北京',campus:'在读研究生',group:'导师身份',facts:[],sourceMap:[]};
it('world_no_private_school_dump_only_approved_mapping; group_progress_retains_related_history',()=>{
 const context={background:'私有全文',worldSetting:'世界',schoolSetting:'校园',backgroundViews:views,events:[{kind:'world',description:'雨'}],plans:[{id:'campus',owner:'campus'},{id:'group',owner:'group'}],items:[{id:'research',owner:'group',kind:'research'},{id:'class',owner:'campus'}],progress:Array.from({length:35},(_,i)=>({id:`p${i}`,taskId:'research'})).concat([{id:'unrelated',taskId:'other'}]),campusTiming:[{id:'class',title:'课程',timing:{}}]};
 const world=buildEnvironmentView({stage:'world',batchId:'b',at:'2026-10-08T06:00:00+08:00',context});expect(world.context.background).toBe('某大学北京');expect(JSON.stringify(world)).not.toContain('私有');expect(world.context.plans).toBeUndefined();expect(world.context.items).toBeUndefined();
 const group=buildEnvironmentView({stage:'school_group',batchId:'b',at:'2026-10-08T06:00:00+08:00',context});expect(group.context.progress).toHaveLength(35);expect(group.context.items).toEqual([{id:'research',owner:'group',kind:'research'}]);expect(group.context.campusTiming).toHaveLength(1);expect(context.progress).toHaveLength(36);
});
