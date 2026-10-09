import type {Storage} from '../storage';
// Data-only read contract shared by live wrappers and detached snapshots.
export type SchoolReadView=Pick<Storage,'read'|'all'>;
