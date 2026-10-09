import {it,expect} from 'vitest';
import {Storage} from '../src/storage';
import {EnvironmentStore} from '../src/environment/store';
import {SchoolStore} from '../src/school/store';
import * as environment from '../src/environment/scheduler';
import {runEnvironmentStep} from '../src/environment/runtime';
import * as notices from '../src/school/notices';
const {runProbes}=require('../scripts/check-scheduling-queries.cjs');
it('fixed active collections keep returned and decoded query rows independent of unrelated history',async()=>{
 const result=await runProbes({Storage,EnvironmentStore,SchoolStore,runEnvironmentStep,...environment,...notices});expect(result.results).toHaveLength(32);
},20000);
