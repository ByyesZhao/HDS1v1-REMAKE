import { resolve } from 'node:path';
import { inspectSharedUpgrade, upgradeSharedActivity } from '../src/deployment/shared-upgrade';
const args = process.argv.slice(2);
const value = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const path = resolve(value('--database') ?? 'runtime/data/hdsi-remake.sqlite');
if (args.includes('--apply') && args.includes('--check')) throw new Error('Choose --check or --apply.');
let report;
if (args.includes('--apply')) {
  const backupDirectory = value('--backup-dir');
  if (!backupDirectory) throw new Error('--apply requires --backup-dir <directory>.');
  report = upgradeSharedActivity(path, new Date().toISOString(), { stopped: args.includes('--stopped'), backupDirectory: resolve(backupDirectory) });
} else report = inspectSharedUpgrade(path);
console.log(JSON.stringify(report, null, 2));
