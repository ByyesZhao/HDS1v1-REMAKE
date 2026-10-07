import type { Dependencies } from '../app';
import { runEnvironment } from './world';
export const runSchool = (d: Dependencies, at: string,turnId?:string) => runEnvironment(d, 'school', at,turnId);
