import { it, expect } from 'vitest';
import { setup } from './helpers';
import { schoolPlan,schoolItem } from './world-school-fixture';
import {normalizeSchoolModels} from '../src/settings';

it('school_records_roundtrip_and_share_transaction',()=>{
 const d=setup(), item=schoolItem();
 d.storage.save('school_plans',schoolPlan.id,schoolPlan);
 d.storage.save('school_plan_items',item.id,item);
 expect(d.schoolStore.items()).toEqual([item]);
 expect(()=>d.storage.transaction(()=>{d.storage.remove('school_plan_items',item.id);throw new Error('rollback');})).toThrow('rollback');
 expect(d.schoolStore.plans()).toEqual([schoolPlan]);expect(d.schoolStore.items()).toEqual([item]);
 d.storage.close();
});
it('school_config_normalization_does_not_modify_input',()=>{
 const raw={models:{school:{model:'deepseek-flash',reasoningEffort:'low'}}}, before=JSON.stringify(raw);
 const normalized:any=normalizeSchoolModels(raw);normalized.models.school_campus.model='deepseek-v4-pro';
 expect(JSON.stringify(raw)).toBe(before);expect(normalized.models.school_week.model).toBe('deepseek-flash');
});

it('environment_marker_not_auto_upgrade', () => {
  const d = setup();
  expect(d.storage.runtime().environmentPlanningVersion).toBe(1);
  const old: any = d.storage.runtime();
  delete old.environmentPlanningVersion; delete old.nextEnvironmentAt;
  d.storage.set('runtime', old);
  expect(d.storage.runtime().environmentPlanningVersion).toBeNull();
  expect(d.storage.runtime().nextEnvironmentAt).toBeNull();
  expect(d.storage.get<any>('runtime').environmentPlanningVersion).toBeUndefined();
  d.storage.close();
});
it('legacy_terminal_predicate', () => {
  const d = setup();
  d.storage.save('turns', 'old', { id: 'old', done: false, legacyDisposition: 'superseded' } as any);
  expect(d.storage.unfinishedTurn()).toBeNull();
  d.storage.save('turns', 'front', { id: 'front', done: false } as any);
  expect(d.storage.unfinishedTurn()?.id).toBe('front');
  d.storage.close();
});
