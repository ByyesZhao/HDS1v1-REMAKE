# Task 2 report — M2 finite maintenance retries and durable Host recovery

Status: implementation complete, self-reviewed, scoped verification green; ready for root-owned independent review and integration. No commit, full-suite run, production/service/config action, online provider, real QQ, or dependency modification. All writes/tests/Git ran through escalated exec in C:\Users\<user>\.codex\worktrees\memory-retry-waking\HDSI-remake (codex/memory-retry-waking-20261013), baseline 86eebb8abcafc8c4ad62c1d49ae731fb837f711e. TEMP/TMP were this tree's .tmp/memory-retry-waking-20261013. All task subprocesses have settled. No source changes followed the final test/typecheck run.

## Files owned by this task

Modified: src/settings.ts; src/deployment/memory-runtime.ts; src/memory/types.ts; src/memory/maintenance.ts; src/memory/store.ts; src/types.ts; src/host/runtime.ts; tests/model-settings.test.ts; tests/memory-maintenance-checkpoint.test.ts; tests/memory-v3-maintenance.test.ts.

New: tests/memory-maintenance-retry-limit.test.ts (28 tests).

No src/app.ts change: actual Host foreground success/failure interleaving and reopen/resume tests prove its catch merges the latest runtime and preserves the independent maintenance owner. Existing tests/memory-idle-host.test.ts remains unchanged and passes; added Host exhaustion/interleaving coverage lives in the new retry-limit test file. Untracked docs/v0.5/records/memory-retry-waking-20261013 is root-owned evidence, not this task's implementation.

## Exact interfaces and inspection fields

Settings and MaintenanceOptions add consolidationTimeoutMs (default 600000, positive number) and consolidationMaxRetries (default 2, nonnegative integer). assembleMemory forwards both. Index work still uses backgroundTimeoutMs default 120000; retryDelayMs remains 300000. Both consolidation and audit use the maintenance limit. The existing model contract name for audit is ALSO memory_consolidation; memory_audit is only its prompt/context stage. ModelClient repairLimit and Web/tool/lookup limits are unchanged.

MaintenanceJob.status adds failed. Compatible optional fields persisted when adopted/dispatched:

- retryCycle: number (new cycle 1)
- executionAttemptCount: number (new cycle 0; atomically incremented before dispatch or retrying saved output)
- failureCount: number (new cycle 0)
- failedAt: string|null (null until terminal)
- attemptId: string|null (fresh UUID for a new execution)
- settledAttemptId: string|null (the attempt already charged a failure)
- retryBaseline?: 'legacy' (older execution history is unknown)
- terminalNotices?: Array<{retryCycle:number; attemptedAt:string; status:'attempted'|'sent'|'failed'}>

The existing job row/id, cutoff, startedAt, selected/read sets, unapplied prepared result and live checkpoint remain available at failure. First/second failure preserve pending (no result) or ready (saved result), with retryAt five minutes later. Third failure sets status=failed and retryAt=null, retaining failureCount=3 and executionAttemptCount=3. Successful preparation and intermediate unit application never reset failureCount or start another execution. The next attempt begins only after a failed attempt; ready replay after a crash continues the unfailed attempt.

Runtime adds independent optional maintenancePause:

    {jobId:string, retryCycle:number, task:string, at:string, safeSummary:string,
     notification:'pending'|'attempted'|'sent'|'failed'} | null

On exhaustion, the failed row, executor history record, runtime.paused=true, maintenancePause, and lastFailure are one SQLite transaction. Runtime.lastFailure adds stage='maintenance' and optional jobId/retryCycle; task='memory_consolidation'. A subsequent foreground catch may replace lastFailure with generation/sending/postprocessing, while maintenancePause preserves the original task, cycle, timestamp and safe summary. Status prints failed job IDs/cycles/execution/failure counts and notification status, and labels lastFailure as the most recent failure.

MemoryMaintenance APIs:

- takeError(): unknown|undefined. Consumes owned fatal storage errors first. Otherwise transactionally claims a pending durable maintenancePause notification: appends the cycle's attempted terminalNotices entry, updates runtime notification to attempted, then returns MaintenanceExhaustedError. Constructor does not call onReady.
- MaintenanceExhaustedError extends Error: readonly jobId, retryCycle; message is exactly `记忆整合重试耗尽，程序已暂停`.
- recordNotification(error:MaintenanceExhaustedError, status:'sent'|'failed'): void. Updates the same cycle's job notice and (if still current) runtime owner; does not overwrite lastFailure or remove pause. Storage failure enters the fatal queue.
- restartFailedCycle(jobId:string, now:string): void. Transactionally verifies the durable pause owner matches the failed row and cycle, increments only that row's cycle, resets its execution/failure counters and attempt/failure fields, chooses ready if saved result exists otherwise pending, and clears paused/lastError/lastFailure/maintenancePause. The now argument retains the agreed interface; no new timestamp is needed for the reset. Other failed rows and all terminalNotices/history remain unchanged. It does not clear any checkpoint or model budget.
- get hasStorageFault(): boolean. In-process fail-closed latch; Host blocks fresh story/background dispatch, timer arming and resume while set. This is needed when the database cannot persist paused=true itself.
- status() now additionally returns failed: Array<{jobId,retryCycle,failureCount,executionAttemptCount}>.

MemoryStore.compactMaintenanceCheckpoint(jobId:string): void is now public so preparation and saved-result replay can use the same M1 transactional archive path independently of whether a WebSearchService is present. jobs() accepts failed; activeMaintenanceJobsReferencing() and reservation scans include failed. Pruning a referenced failed job does not turn it into done. Dispatch/deadline scans exclude failed jobs. Both incremental/idle and legacy daily reservation paths are tested.

## Execution, restart, and archival contracts

Each model call receives executionAttempt={retryCycle,attemptId}, independent of ModelClient's diagnostic invocation UUID. Executor failures use ModelRunHistory.recordFailure with deterministic invocationId `maintenance:<jobId>:<retryCycle>:<attemptId>`, responseSequence=0, stage='maintenance', category='execution'|'timeout'|'interrupted'; runId uses the existing Web stage when present, otherwise a deterministic maintenance:<jobId> reference. Failure state and history commit together; settledAttemptId prevents charging twice. Diagnostic model request/parse records remain separate.

Preparation now durably writes ready output BEFORE archival. It then archives/clears the checkpoint inside its caught execution path and only signals readiness after success or accounted failure. The finally block only clears timers/listeners. All-stale output also saves ready first, archives, then changes to done. Archive failure leaves ready output and checkpoint intact, records one failure, and schedules a commit/archive retry. Saved-result application starts a new attempt only after a previous failure, archives inside its application transaction, and never calls the model again. A terminal done-save failure rolls back unit changes. Successful intermediate units share the original attempt. All async preparation rejections are owned, converted to a durable retry or explicit storage fault, and signalled to Host; there is no unprotected rejecting finally.

Restart:

- Modern computing with no saved result charges one interrupted failure to its persisted attempt; terminal third interruption pauses. Reopen never resets counts or charges the same attempt again.
- Legacy computing without attempt metadata adopts the ONE observed in-flight execution using `legacy-interrupted:<jobId>:<retryCycle>`, retryBaseline='legacy', executionAttemptCount=1/failureCount=1, and a retry deadline. Adoption, history and failure state are atomic. Older retries are explicitly unknown, not inferred. Reopening again does not re-charge it.
- Legacy unstarted pending starts at zero when normalized for dispatch. Computing with a saved result becomes ready without failure or a model call.
- MemoryStore.migrateCapacity no longer preemptively turns maintenance computing into pending (index compatibility is unchanged), allowing executor reconciliation to see the interruption. A real migration+constructor regression verifies this and verifies no synchronous onReady callback before Host assignment.

Notifications are serialized through Host after the current front turn finishes. A persistent claim precedes both logging and the external send. Repeated wake, sender rejection and disk reopen never resend the same claimed cycle. Sender failure records failed notification state without replacing the original failure. Delivery is at most one automatic attempt per cycle, NOT crash-proof exactly-once delivery: a crash after claim but before send may leave attempted with no delivered notice. Status exposes that ambiguity.

Graceful stop waits all foreground/environment/background drains, then consumes maintenance errors even though wake is disabled. Successful drain consumes no failure. A model or archive failure that was durably saved as a retriable state is a successful safe stop (retry remains for restart); terminal exhaustion is logged/notified after drain and the job remains paused. Unrecoverable accounting/finalization storage failure causes stop to reject after all drains. If even paused=true cannot be written, a local fault latch still stops every future Host dispatch; the error explicitly states that durable pause persistence failed. No claim is made that a completely unwritable database was reliably updated.

## TDD and verification evidence

All logs below are under .tmp/memory-retry-waking-20261013. Commands ran with that directory as TEMP/TMP.

1. Initial RED: `npm test -- tests/memory-maintenance-retry-limit.test.ts tests/model-settings.test.ts tests/memory-idle-host.test.ts` — 9 failed / 20 passed; one unhandled archive rejection reproduced R2. Missing terminal/counter/settings state and archival accounting were real product failures. The first timeout test also had an incorrect transport signal argument, corrected before GREEN; the dedicated mutation RED below proves the corrected boundary assertion.
2. Initial implementation typecheck caught only test fixture typing/signal issues after a UTF-8 Python invocation correction. No product write occurred during the failed default-GBK script invocation. Subsequent typecheck passed.
3. Intermediate GREEN scope exposed intentional old checkpoint test expectations: timeout override now sets consolidationTimeoutMs; readiness callback now observes already archived checkpoint; attempt linkage changes while repair payload/budget remain equal. Those tests were updated to the new contract. Scope then passed.
4. Shutdown RED: `npm test -- tests/memory-maintenance-retry-limit.test.ts tests/memory-maintenance-checkpoint.test.ts` — 1 failed / 29 passed because terminal exhaustion during graceful stop was claimed/thrown rather than sent. Fixed stop's owned drain/reporting.
5. Storage RED: `npm test -- tests/memory-maintenance-retry-limit.test.ts -t 'dispatch_persistence|storage_unavailable'` — 2 failed / 18 skipped: no global pause on dispatch write failure; endless new errors after inaccessible DB queue drained. Fixed fail-closed latch and finite drain. The first fault-injection attempt hung its test cleanup because its failing assertion skipped mock restoration; only the verified synthetic Vitest process and child were terminated, cleanup changed to try/finally, and the bounded RED above was rerun. No source edit overlapped the running process. Final tests contain no unhandled errors.
6. Audit RED: `npm test -- tests/memory-maintenance-retry-limit.test.ts -t 'all_stale|audit_uses'` — 1 failed / 1 passed / 24 skipped: executor history used memory_audit while the existing model task name is memory_consolidation. Fixed without changing contracts/model routing. The all-stale fixture also needed startedAt set so normal unstarted refresh did not deliberately drop its synthetic dependency.
7. Legacy RED: `npm test -- tests/memory-maintenance-retry-limit.test.ts -t legacy_computing` — 1 failed / 26 skipped (observed interruption wrongly remained 0/0). Fixed atomic 1/1 adoption; matching GREEN passed.
8. Timeout mutation RED: temporarily restored only the old 120000 consolidation fallback, ran `npm test -- tests/memory-maintenance-retry-limit.test.ts -t consolidation_times_out_at_600_seconds_not_120`, then restored source in finally after process exit — 1 expected failure / 26 skipped at the assertion that 599999ms must remain un-aborted. The final source uses 600000 and passes, while the separate index test aborts at 120000.
9. Unpersistable-pause RED: `npm test -- tests/memory-maintenance-retry-limit.test.ts -t unpersistable_pause` — 1 failed / 27 skipped: three foreground model calls could dispatch after the fatal queue emptied if runtime writes themselves failed. Added Host local-fault dispatch gates; final GREEN passes with zero foreground calls.
10. Final stable GREEN: `npm test -- tests/memory-maintenance-retry-limit.test.ts tests/memory-maintenance-checkpoint.test.ts tests/memory-idle-host.test.ts tests/memory-idle-recovery.test.ts tests/memory-idle-fairness.test.ts tests/memory-v3-maintenance.test.ts tests/model-settings.test.ts tests/memory-capacity-prune-race.test.ts tests/model-run-history.test.ts` — 9 files, 102 tests passed; exit 0. Log task-2-final-scoped.log (10:45:31 run). Includes repaired older v3 default-timeout test now expecting 600 seconds.
11. Final `npm run typecheck` — exit 0, task-2-typecheck-final.log. Final `git diff --check` — exit 0; only the existing LF-to-CRLF checkout-policy warning for model-settings test, no whitespace defect.

No full-suite or build claim is made. Root owns final stable complete suite/build/demo/plugin acceptance after W1 integration.

## Self-review and outstanding concerns

The final 28 new tests cover exhaustion/one notice, two real five-minute waits, 600/120-second boundaries, retained history after successful retry, third computing interruption over disk reopen, unrelated failed-row preservation, archive INSERT-trigger failures and saved-result retries, failed notices/reopen, actual foreground success and failure while third maintenance request is in flight, real mixed foreground+maintenance failure reopened from disk then resumed, legacy accounting, multiple units sharing an attempt, application UPDATE-trigger rollback, storage accounting failures, constructor ordering, all-stale archival, manual resume preserving exhausted repair budget/same run, audit naming, zero retries, and fatal state that cannot be persisted. Existing checkpoint tests cover forced stop and late model response not committing or clearing live checkpoint.

No unresolved implementation defect identified in self-review or final scoped verification. Independent review and final root-owned full-suite remain required. The storage-failure latch intentionally requires storage repair plus a fresh runtime before resume; it cannot promise persistence when SQLite refuses writes. External notice delivery has the explicit at-most-one-attempt limitation above. Historical records remain unbounded per approved M1; no retention policy was added. Production configuration is untouched and still requires root's authorized final setting/deployment work.
