import type {ISOTime} from '../types';
import type {SchoolExpansionInput} from '../school/types';
import type {EnvironmentStep,EnvironmentTerminalAudit} from './types';
import {digest} from './digest';

// The caller owns the transaction and must exclude the same step's active execution.
export function compactTerminalEnvironmentStep(step:EnvironmentStep,at:ISOTime):EnvironmentStep|null {
 if(step.preparationVersion!==1||!['committed','superseded'].includes(step.status))return null;
 if(step.terminalAudit&&step.inputSnapshot==null&&step.preparationSnapshot==null&&step.frozenResult==null)return null;
 const input=step.inputSnapshot,preparation=step.preparationSnapshot,result=step.frozenResult;
 let summary:EnvironmentTerminalAudit['result']=null;
 if(result){
  let entityIds:Record<string,string[]>;
  if(result.stage==='world')entityIds={createdEvents:result.changes.filter(c=>c.action==='create').map(c=>c.id!),updatedEvents:result.changes.filter(c=>c.action==='update').map(c=>c.id!),cancelledEvents:result.changes.filter(c=>c.action==='cancel').map(c=>c.id!)};
  else if(result.stage==='school_week')entityIds={instances:result.instances.map(r=>r.id),notices:result.notices.map(r=>r.id),weeks:result.weeks.map(r=>r.id)};
  else entityIds={plans:result.plans.map(r=>r.id),items:result.items.map(r=>r.id)};
  summary={stage:result.stage,entityIds,counts:Object.fromEntries(Object.entries(entityIds).map(([key,ids])=>[key,ids.length]))};
 }
 const terminalAudit:EnvironmentTerminalAudit={...step.terminalAudit,version:1,compactedAt:at,
  input:{modelContractVersion:input?.modelContractVersion??null,requiredNoticeIds:input?.stage==='school_week'&&input.modelContractVersion===1?(input.context as SchoolExpansionInput).requiredNoticeKeys.map(n=>n.id):null},
  basis:{businessBasis:preparation?.businessBasis??null,retrievalSignature:preparation?.retrieval.signature??null,usedBasisDigest:preparation?.usedBasis?digest(preparation.usedBasis):null,inputDigest:input?digest(input):null,preparationDigest:preparation?digest(preparation):null,resultDigest:result?digest(result):null},result:summary};
 return {...step,terminalAudit,inputSnapshot:null,preparationSnapshot:null,frozenResult:null};
}
