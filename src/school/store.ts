import type { Storage } from '../storage';
export class SchoolStore {
 constructor(readonly storage:Storage){}
 plans(){return this.storage.all('school_plans');}
 items(){return this.storage.all('school_plan_items');}
 instances(){return this.storage.all('school_instances');}
 notices(){return this.storage.all('school_notices');}
 knowledge(){return this.storage.all('school_knowledge');}
 progress(){return this.storage.all('school_progress');}
 weeks(){return this.storage.all('school_weeks');}
}
