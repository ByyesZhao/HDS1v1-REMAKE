import type { ISOTime, ScheduledTask, TaskChange } from '../types';
import { milliseconds } from '../time';

// Shared by planning and transactional commit. Consumption is judged against
// the original rows and the frozen turn time, never the later commit clock.
export function projectTaskChanges(
  tasks: readonly ScheduledTask[],
  changes: readonly TaskChange[],
  completedTaskIds: readonly string[],
  turnAt: ISOTime,
): ScheduledTask[] {
  const original = new Map(tasks.map(task => [task.id, task]));
  const completed = new Set(completedTaskIds);
  const projected = tasks.map(task => ({
    ...structuredClone(task),
    status: task.status === 'pending' && completed.has(task.id) ? 'completed' as const : task.status,
  }));
  const positions = new Map(projected.map((task, index) => [task.id, index]));
  for (const change of changes) {
    if (change.action === 'create') {
      projected.push({ ...structuredClone(change.task), id: change.id!, status: 'pending' });
      continue;
    }
    const old = original.get(change.id);
    const index = positions.get(change.id);
    if (!old || index === undefined) continue;
    if (change.action === 'cancel') {
      projected[index] = { ...projected[index], status: old.status === 'pending' ? 'cancelled' : old.status };
      continue;
    }
    const final = { ...projected[index], ...structuredClone(change.task) };
    const rescheduled = change.task.at !== undefined
      && milliseconds(final.at) !== milliseconds(old.at)
      && milliseconds(final.at) > milliseconds(turnAt);
    final.status = old.status !== 'pending' ? old.status
      : !completed.has(old.id) || rescheduled ? 'pending' : 'completed';
    projected[index] = final;
  }
  return projected;
}
