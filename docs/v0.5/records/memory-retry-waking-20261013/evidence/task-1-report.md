# Task 1 report — M1 persistent model history

Status: M1 implementation complete and self-reviewed; ready for root-owned independent review. No commits, deployment, service actions, real configuration/database access or online providers were used. Worktree: C:\Users\<user>\.codex\worktrees\memory-retry-waking\HDSI-remake. Branch: codex/memory-retry-waking-20261013. Baseline: 821e23012d6f99b417a55a50bdd5a10674cb8a50. All test subprocess TEMP/TMP values used this worktree's .tmp/memory-retry-waking-20261013; dependencies were not installed/changed.

## Changed files

New:
- src/model/run-history.ts
- tests/model-run-history.test.ts

Modified:
- src/storage.ts
- src/model/client.ts
- src/deployment/plugin-runtime.ts
- src/memory/types.ts
- src/web/types.ts
- src/web/store.ts
- src/web/service.ts
- src/memory/store.ts
- src/memory/payload-compaction.ts
- src/deployment/memory-payload-compaction.ts
- src/app.ts
- src/recovery.ts
- src/environment/runtime.ts
- src/environment/preparation.ts
- tests/memory-payload-compaction.test.ts
- tests/memory-payload-compaction-cli.test.ts
- tests/runtime-check-readonly.test.ts
- tests/environment-web-finalization.test.ts

Scope expansions were explicitly approved by root: controlled writable history-table initialization for the legacy compaction CLI; optional checkpoint executionAttempt metadata; runtime readonly regression; minimal archive-reason arguments in generation/recovery/environment callers. No maintenance.ts, Host behavior, retry-budget logic or business-generation behavior was changed. This report is local ignored evidence at .superpowers/sdd/README/task-1-report.md.

## Implementation and interfaces for M2

The writable Storage constructor now creates only the additive model_run_records(id TEXT PRIMARY KEY, data TEXT NOT NULL) table. Storage.initializeModelRunHistory(connection: Pick<Storage,'prepare'>) is the explicit schema helper used by the writable compaction CLI. Storage readOnly returns before DDL. ModelRunHistory's constructor does no DDL; list(owner) tolerates an absent history table by returning []. No version changes or historical backfill.

src/model/run-history.ts exports:
- ModelRunRecord: discriminated type `failure` or `checkpoint`; common id, runId, taskName, optional ownerType/ownerId/stageKey, occurredAt, retryCycle/attemptId. Failure adds invocationId, responseSequence, stage, category, error, optional rawResponse/checkpoint. Archive adds reason and checkpoint.
- ModelRunHistory(storage: Pick<Storage,'prepare'>, clock: Clock).
- append(record): immutable insert, ON CONFLICT(id) DO NOTHING. Callers retry the same id for write idempotence; they must supply distinct ids for distinct events.
- recordFailure(record: ModelRunFailure): convenience method adding occurredAt via the injected clock and id `failure:<invocationId>:<responseSequence>:<category>`. M2 can pass its own UUID invocationId, event sequence, maintenance run reference, retryCycle, attemptId, stage/category/error and optional checkpoint.
- archiveCheckpoint(ref, checkpoint, reason): id `checkpoint:<runId>:<sha256(JSON.stringify(checkpoint))>:<reason>`. Never updates an existing archive.
- list(owner): explicit forensic read only, insertion order, no automatic model/retrieval use.
- CheckpointArchiveReason: completed | superseded | cancelled | compacted.
- withModelHistorySavepoint(storage, synchronousFunction): nestable SAVEPOINT/rollback/release.
- archiveAndClearCheckpoints(storage, history, trustedWhereSql, parameters, reason, optionalLimit): selection, immutable inserts and clearing of selected live checkpoint rows in one savepoint. Returns selected row count. It preserves legacy raw checkpoint snapshots without decoding or truncating them. It fails closed on attempted checkpoint archival with missing history schema.

ModelClient's original three arguments retain their meaning; fourth optional history is injected into the production client using official Storage and clock. Each runModel call creates a diagnostic UUID independent of business runId and executionAttempt. Each response sequence has an independent immutable failure id, including exhausted-budget last drafts and later resumed foreground calls. Every parse failure records rawResponse plus the pre-repair current input/repair/tool/lookup checkpoint before budget checking. Transport failures also record safe error text and request/context_limit/interrupted categories; arbitrary transport Error text is deliberately generic so authentication details cannot leak. ChatCompletionsTransport's structured safe ModelRequestError text is preserved. No token usage/billing or transport headers/configuration are added.

ModelRunOptions now accepts executionAttempt?: {retryCycle:number; attemptId:string}. WebModelCheckpoint has compatible optional executionAttempt metadata (formatVersion remains 2). ModelClient replaces that metadata with the current supplied attempt without resetting business runId, tools or repairCount. Archives copy it into top-level linkage fields. It is never part of CompletionRequest/model input. Calls without web/provider/runRef can still retain diagnostic records with taskName and transient diagnostic runId; they do not fabricate owner metadata or create a recoverable checkpoint.

WebSearchStore and MemoryStore accept optional history instances, otherwise using storage/systemClock. WebSearchStore.compactStages(..., reason='superseded') and compactOwnerCheckpoint(..., reason='completed') archive before clearing. WebSearchService.finalizeOwner(..., reason='completed') and compactOwnerCheckpoint(..., reason='completed') forward the reason and allow failures to propagate. Maintenance done-save uses an enclosing savepoint so job status/payload changes also roll back if archival fails; nonterminal/index saves keep their prior write behavior. Bounded terminal payload SQL selection routes checkpoint clearing through the same helper; other payload compaction remains bounded and recovery owners retain live snapshots.

Success uses completed; generation rebinding uses superseded; environment terminal paths read actual terminal metadata to select completed/superseded; old terminal SQL cleanup uses compacted. Materials/operations/self-read sources/image observation records are not deleted by archival. Existing asset lifecycle is not pinned, and no permanent image-pixel preservation is claimed.

## TDD and verification evidence

All log files are under .tmp/memory-retry-waking-20261013.

1. Initial RED: `npm test -- tests/model-run-history.test.ts` — 14/14 failed against original product code. Missing historical records (empty arrays), missing writable schema, and silent checkpoint deletion on injected archive-write failure were the observed assertion failures. No collection/import failure. Initial test-only optional dynamic history lookup allowed existing product code to execute without the new module; it was replaced by the final static import after implementation. Log: task-1-red.log.
2. Initial GREEN: same command — 14/14 passed; initial typecheck passed. Logs: task-1-green-initial.log, task-1-typecheck-initial.log.
3. Attempt-linkage RED: history tests — 1 failed, 18 passed, because archived checkpoint lacked retryCycle and attemptId. After the compatible checkpoint metadata change it passed. Log: task-1-attempt-red.log.
4. Legacy CLI mutation RED: `npm test -- tests/memory-payload-compaction-cli.test.ts -t 'legacy CLI'` with the new explicit CLI schema initialization temporarily removed, then restored in finally — expected `no such table: model_run_records`, 1 failed/6 skipped. Log: task-1-cli-red.log. This proves the old writable CLI boundary genuinely needs the controlled initialization.
5. Scoped GREEN: `npm test -- tests/model-run-history.test.ts tests/web-persistence-v2.test.ts tests/web-recovery.test.ts tests/memory-maintenance-checkpoint.test.ts tests/memory-capacity-prune-race.test.ts tests/memory-payload-compaction.test.ts tests/memory-payload-compaction-cli.test.ts` — 65 tests/7 files passed, typecheck passed. Log: task-1-scoped-green.log.
6. Transport-category RED: `npm test -- tests/model-run-history.test.ts -t 'transport_failures'` — 1 failed/19 skipped because context_limit was stored as request. Fixed preserving safe ModelRequestError.kind. Log: task-1-transport-red.log.
7. Runtime compatibility: build passed; `npm test -- tests/model-run-history.test.ts tests/runtime-check-readonly.test.ts` — 22 tests/2 files passed. Synthetic runtime fixture explicitly drops history table. Built-lib launcher schema3 succeeds/schema2 requires migration, without table creation or database-byte changes. Logs: task-1-build.log, task-1-runtime-green.log.
8. Archive-reason RED: `npm test -- tests/environment-web-finalization.test.ts` — 7 failed/8 passed, because modern and legacy expired/superseded executions archived as completed. Minimal reason plumbing fixed this; `npm test -- tests/environment-web-finalization.test.ts tests/model-run-history.test.ts tests/reply-freshness-turn.test.ts tests/recovery.test.ts` — 51 tests/4 files passed. Logs: task-1-reason-red.log, task-1-reason-green.log.
9. Final typecheck: `npm run typecheck` — exit 0. Log: task-1-typecheck.log.
10. Final build: `npm run build` — exit 0. Log: task-1-build-final.log.
11. Final scoped verification on stable edited sources: `npm test -- tests/model-run-history.test.ts tests/web-persistence-v2.test.ts tests/web-recovery.test.ts tests/memory-maintenance-checkpoint.test.ts tests/memory-capacity-prune-race.test.ts tests/memory-payload-compaction.test.ts tests/memory-payload-compaction-cli.test.ts tests/runtime-check-readonly.test.ts tests/environment-web-finalization.test.ts tests/reply-freshness-turn.test.ts tests/recovery.test.ts` — exit 0; 99 tests/11 files passed. Log: task-1-final-scoped.log.
12. `git diff --check` — exit 0 after newline normalization. Git printed existing LF-to-CRLF checkout-policy notices, no whitespace defects.

Full-suite attempt: bare `npm test` started at 10:17:32 before root requested and before implementation of the extra reason plumbing; it overlapped that RED/GREEN edit. It finished in 220.06 seconds: 221 files, 220 passed/1 failed; 1435 tests, 1426 passed/7 failed/2 skipped. Log: task-1-full-suite.log. All failed tests were the added superseded reason assertions running against the pre-change loaded runtime/preparation code:
- expired_ready_step_schedules_cleanup_before_stale_return
- reconcile_cleans_non_active_superseded_owners
- scheduler_supersede_is_observed_by_preparation
- legacy_already-terminal_finalizes_checkpoint_and_retains_legacy_payload
- legacy_expired-before_finalizes_checkpoint_and_retains_legacy_payload
- legacy_expired-error_finalizes_checkpoint_and_retains_legacy_payload
- legacy_expired-result_finalizes_checkpoint_and_retains_legacy_payload

These 7 are all green in the final stable scoped run, which includes all 15 environment finalization tests. No other full-suite failure occurred. A stable complete full-suite run is still root-owned final acceptance after M2/W1; this report does not claim final full-suite green. All subprocesses from this task have settled; none remain running. Expected negative CLI tests emit a stopped-flag error from a child process even though the test passes; it is recorded in logs, not an unexpected failing test.

## Self-review and requirements check

- Budget remains repairLimit=2; exhausted third invalid raw and resumed fourth invalid raw have distinct persistent ids, including close/reopen.
- Four checkpoint deletion paths have real-SQL coverage and real INSERT-trigger failure rollback coverage (stages, owner, MemoryStore done-save, old SQL payload compaction), including nesting inside an outer transaction.
- Done-save archival failure restores both the live checkpoint and prior job state.
- Repeated clears do not create records when no checkpoint exists; repeated append/archive ids never overwrite data.
- Historical input/repair/private lookup is preserved; material references and synthetic image observations remain resolvable; generation/current input ignores archive data.
- Success/finalization/resume/purgeOwner/reopen retain history. Active restoration checkpoint source is only web_sessions.checkpoint.
- New/old writable schema, old readonly missing table, readonly list and CLI/runtime dry-runs are covered. Legacy bare-DB attempted clears fail closed; unrelated old payload operations without checkpoint deletions remain usable.
- Archive SQL selects only actual checkpoint rows and leaves active-owner/resume snapshots intact until caller-authorized terminal cleanup.
- Production persistence is independent of web enabled/provider existence; no real secrets/provider payload usage or model billing fields are introduced.
- Every direct checkpoint-to-NULL mutation is now in the shared archive helper; the payload-spec SQL string is a selector/spec, not a separate executed destructive bypass.
- Only minimal reason arguments were added to app/recovery/environment business files. No changes to retry budget, finalizer ownership/awaiting, error delivery or Host scheduling in this task.

## Outstanding concerns / next integration work

No unresolved M1 defect identified by self-review or the final scoped run. Root must independently review M1 and perform final stable full-suite/build/demo/plugin acceptance after remaining implementation. M2 owns executor timeout/interruption/commit-failure records, attempt identity lifecycle and finalizer/error propagation; ModelClient transport recording is not a substitute for those. M2 can use the exported recordFailure API and executionAttempt metadata described above.

History retention is intentionally unbounded for this batch and remains private database/backup evidence. No history/production DB content is added to Git. Original plan/review evidence was preserved. Existing image-asset lifecycle continues; retained observation/reference metadata does not promise permanent pixel retention.
