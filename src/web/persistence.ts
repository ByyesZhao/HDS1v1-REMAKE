import type {LegacyWebModelCheckpoint,LegacyWebOperationRecord,WebModelCheckpoint,WebOperationState,WebSearchResponse,WebToolResultRef,WebMaterial} from './types';

export function toResultRef(response:WebSearchResponse):WebToolResultRef {
 const {materials,...metadata}=response;return {...metadata,materialIds:materials.map(m=>m.id)};
}
function version(value:object):void {
 if('formatVersion' in value&&value.formatVersion!==2)throw Error(`unsupported web payload formatVersion ${value.formatVersion}`);
}
export function decodeCheckpoint(value:LegacyWebModelCheckpoint|WebModelCheckpoint):WebModelCheckpoint {
 version(value);if('formatVersion' in value)return value;
 return {...value,formatVersion:2,toolResults:value.toolResults.map(toResultRef)};
}
export function decodeOperation(value:LegacyWebOperationRecord|WebOperationState):WebOperationState {
 version(value);if('formatVersion' in value)return value;
 return {...value,formatVersion:2,response:value.response?toResultRef(value.response):null};
}
export function hydrateResult(ref:WebToolResultRef,materials:ReadonlyMap<string,WebMaterial>):WebSearchResponse {
 const {materialIds,...metadata}=ref;
 return {...metadata,materials:materialIds.map(id=>{const material=materials.get(id);if(!material)throw Error(`missing web material ${id}`);return material;})};
}
