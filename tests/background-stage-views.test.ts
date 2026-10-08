import {it,expect} from 'vitest';
import {backgroundFor} from '../src/model/background-views';
import {prepareBackgroundViews} from '../src/deployment/character-background';
it('no_mapping_full_background_fallback',()=>{expect(backgroundFor({background:'完整作者背景'},'world')).toBe('完整作者背景');});
it('detail_move_does_not_remove_shared_identity',()=>{
 const candidate=prepareBackgroundViews('她是学生，手机某手机。\n\n说话轻松。',[{paragraph:0,uses:['core','group'],text:'她是学生。'},{paragraph:1,uses:['style'],text:'说话轻松。'}],[{paragraph:0,key:'phone',value:'某手机',aliases:['手机']}]);
 expect(candidate.core).toBe('她是学生。');expect(candidate.group).toBe('她是学生。');expect(candidate.facts[0].source.paragraph).toBe(0);expect(candidate.sourceMap[0].original).toContain('某手机');expect(candidate.status).toBe('candidate_pending_review');
});

import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {initializeMissingBackgroundFacts} from '../src/model/background-views';
it('updated_detail_not_overwritten_by_author_copy',()=>{const storage=new Storage(':memory:'),store=new MemoryStore(storage),at='2026-10-08T06:00:00+08:00';try{store.migrate(at);store.saveOwner(store.makeOwner({ownerType:'detail',ownerId:'phone'},{content:'新手机',key:'phone',value:'新手机'},at));const views=prepareBackgroundViews('旧手机',[{paragraph:0,uses:['core'],text:''}],[{paragraph:0,key:'phone',value:'旧手机',aliases:[]}]);views.status='approved';expect(initializeMissingBackgroundFacts(store,views,at)).toBe(0);expect(store.owner({ownerType:'detail',ownerId:'phone'})!.value).toBe('新手机');}finally{storage.close();}});
