# M2 independent spec and quality review

Reviewed range: `86eebb8abcafc8c4ad62c1d49ae731fb837f711e..a0444a0ce1d861253330d1d49f6e830f3d9fc143`.

Spec verdict: **REQUEST CHANGES** — one shutdown error-propagation contract is not met.

Quality verdict: **REQUEST CHANGES** — one reproducible P2 correctness issue; no other blocking finding identified in this scoped review.

## R-M2-1 · P2: Preserve a consumed storage fatal for the shutdown result

Location: `src/host/runtime.ts:165-170` (particularly line 168); related `src/memory/maintenance.ts:74-76` and `src/host/runtime.ts:45-49`.

`SerialHost.stop()` rejects only for rejected drain promises or errors remaining in `takeError()`. During ordinary operation, the pump already consumes a fatal storage error through `reportMaintenanceError()`; `wake()` catches it and reports it to `onError`, so its promise resolves. `takeError()` then returns undefined once the queue is empty even though `hasStorageFault` remains true. A later graceful stop therefore resolves successfully while the original failure remains unaccounted in storage. This contradicts the agreed explicit distinction between durably saved retriable failures (safe stop may succeed) and unrecoverable accounting/finalization storage failures (stop must reject after every drain). It can also give the deployment caller a false successful-stop result.

Reproduced with an inline, synthetic in-memory probe using the real MemoryMaintenance and SerialHost: seed a pending job, add an INSERT trigger that rejects writes to model_run_records, use a fake model that throws, start maintenance, wait for prepare and Host wake to settle, then call `host.stop({graceful:true})`. Exact output:

```json
{"errors":["记忆维护存储故障，已停止派发"],"hasStorageFault":true,"job":"computing","stopResult":"resolved"}
```

The fault is logged and dispatch correctly stays blocked, but logging has consumed its shutdown ownership. The existing test `storage_accounting_failure_is_owned_and_blocks_dispatch_during_stop` injects the fault after stop begins, so it does not cover this ordering.

Requested change: retain a fatal cause independently of the notification/error-drain queue, or have shutdown check the latched fatal state after all drains and reject with an appropriate storage failure. Keep notification delivery bounded and keep `takeError()` finite. Add a regression where Host has already consumed/logged the error before graceful stop; also cover a failed durable-pause write with all queued errors consumed. Successful drains and durably recorded retryable model/archive failures must continue to resolve.

## Contracts checked without additional findings

- Separate consolidation/audit 600000 ms timeout and index 120000 ms timeout; settings defaults, validation, and runtime plumbing.
- Initial execution plus two retries, durable attempt identities, per-attempt failure deduplication, preserved failure counts across successful preparation and individual unit commits, and explicit manual retry cycle reset.
- Legacy computing adoption counts exactly the one observed interruption as execution 1/failure 1 and labels the unknown history legacy; computing with saved output becomes ready; migration leaves computing visible to reconciliation.
- Transactional failed job/history/global pause; maintenancePause persists independently of foreground lastFailure; actual foreground success/failure interleaving retains the maintenance owner; resume selects only the recorded cycle.
- Durable notification claim before automatic send, one attempt per cycle across sender failure and reopen, with attempted ambiguity exposed in status.
- Failed jobs retain reservation/reference protection in idle and daily paths and stay excluded from execution/deadline scans.
- Preparation saves ready output before caught checkpoint archive, including all-stale output; ready replay and transactional application/archive failures reuse output across reopen without a fresh model call; partial-unit application shares an attempt.
- Constructor does not call onReady before Host assignment; preparation promises have an owned catch; storage-fault latch blocks foreground/background dispatch and resume even if paused=true cannot persist.
- Audit retains the memory_consolidation model name with memory_audit prompt stage; existing repair and lookup/tool budgets remain unchanged.

## Evidence and limits

Read the original approved plan, its REVIEW.md R1/R2 revisions, task-2 brief/report, M1 history interfaces, M2 diff, implementation, and meaningful targeted test bodies. Inspected task-2-final-scoped.log: 9 files / 102 tests passed at 10:45:31, and task-2-typecheck-final.log. No fresh full-suite run was performed. The only new execution was the bounded synthetic in-memory shutdown probe above; it used no real configuration, provider, formal database, service, or network.

The shared worktree HEAD had advanced to c60b20418bfa274d49960989af4cdf99bc19ae02 during review; `git diff a0444a0..HEAD -- src/host/runtime.ts src/memory/maintenance.ts` was empty, confirming the probe exercised the reviewed M2 implementation. Root-owned documentation changes were left untouched. Only this report was written. No source edits, commits, deployment, start/resume, or subagents were performed.

## Independent corrective closure — 367747a6ca9c587e18d0eb069af8e474b479fd4a

The whole-branch reviewer independently reviewed c60b204..367747a and the 12-file/134-test passing correction scope plus typecheck evidence. R-M2-1 is CLOSED: MemoryMaintenance.storageError retains the first fatal cause after takeError is consumed; Host.stop adds it to the shutdown result after all drains, with identity deduplication. New real Host regressions consume/log the queue before stop, cover inability to persist paused, and verify both deferred drains settle before rejection. Reliable retryable failures and successful drains retain their prior semantics.

The additional whole-branch diagnostic-history finding is also CLOSED: prepare/archive/apply phases and bounded credential-redacted local diagnostics persist in immutable records; public summaries stay generic. Real archive/application SQL-trigger tests verify retention after retry and manual resume without another model request, with explicit transport/local secret-canary checks. Full details and the initial reproduction are preserved in final-review.md.

Compatibility corrections preserve computing migration visibility, implement the new Host boundary in its partial test stub, and use real SQLite done-marker failures to test transaction rollback and retained retry state across maintenance disk reopen. They do not remove the original atomicity/no-regeneration assertions.

Updated M2 spec verdict: APPROVED. Updated M2 quality verdict: APPROVED. The initial request-changes verdict and original P2 reproduction above remain historical evidence. Root's whole-project engineering gates and deployment facts are separate and pending at this closure.
