# Task 2 correction report — review findings and full-suite compatibility

Status: corrective implementation complete, self-reviewed, product/test edits frozen for root-owned review and stable gates. Worktree C:\Users\<user>\.codex\worktrees\memory-retry-waking\HDSI-remake, baseline c60b20418bfa274d49960989af4cdf99bc19ae02. No commit, full-suite run, deployment, service operation, configuration change, online provider, or W1 change. Root-owned documentation edits were left untouched. All commands used this managed tree and authorized escalated execution; all tests set TEMP/TMP to .tmp/memory-retry-waking-20261013. No test process remains outstanding.

## Changed files

Product: src/memory/maintenance.ts, src/host/runtime.ts.

Tests: tests/memory-maintenance-retry-limit.test.ts; tests/memory-capacity-upgrade.test.ts; tests/memory-projection-retrieval.test.ts; tests/memory-v3-recovery.test.ts; tests/memory-idle-host.test.ts; tests/memory-v3-maintenance.test.ts.

No M1 schema/history API or W1 source change. The new retry-limit file now contains 37 tests (9 additions in this correction).

## R-M2-1: fatal storage failure survives error-queue consumption

MemoryMaintenance retains its first fatal Error independently of the finite takeError queue. New read-only getter `storageError: Error | undefined` exposes that retained object to shutdown. hasStorageFault and all existing fail-closed dispatch/resume behavior remain unchanged.

After waiting for foreground, background and environment drains with Promise.allSettled and consuming remaining error queues, SerialHost.stop checks storageError. It includes that cause in the final rejection even when the pump previously consumed/logged it; identity deduplication avoids adding the same object twice if it was still queued. A single error is thrown directly; multiple errors use the existing AggregateError path.

The two new ordering regressions first let the real Host consume every storage error, assert the queue is empty, and only then call graceful stop. One rejects the accounting write; the other also rejects the durable paused=true write. Deferred wrappers around the actual background/environment stop methods verify stop remains pending until BOTH drains finish, then rejects with the retained storage fault. Existing successful-drain and durably saved retriable model/archive failure cases continue to resolve.

## R-M2-2: preserve safe immutable diagnostics and execution phase

Executor history still has stage='maintenance', same owner/job/cycle/attempt linkage, and deterministic event identity. Its category now identifies `prepare`, `archive`, or `apply`; `timeout` and `interrupted` retain their explicit categories. No schema or protocol change is required because category is already a string. Existing history is immutable and not rewritten.

Preparation tracks the phase when checkpoint archival or all-stale finalization runs. Ready replay tracks checkpoint archival separately from unit application/commit. The failure record's error now contains the bounded diagnostic for that phase, rather than only the generic user-facing pause/retry summary. Real SQLite INSERT/UPDATE trigger regressions prove specific archive and commit errors survive both ordinary retry-to-done and terminal-failure/manual-resume-to-done, even though the live lastError is cleared on success. Prepared output is still reused, with one model call across those retries.

Safety boundary:

- Unknown preparation/transport errors are reduced to `maintenance model preparation failed`; arbitrary Error text/objects are not dumped.
- Existing sanitized ModelRequestError and ModelFormatError messages can be retained, with the same credential redaction and length bound. A ModelRequestError regression preserves the safe HTTP 401 classification.
- Local archive/apply failures retain Error.message only, never stack, cause, arbitrary object properties, SQL payload objects, or transport headers. The message is credential-redacted, whitespace-normalized and limited to 2000 characters before its short phase prefix.
- Redaction covers Authorization/Proxy-Authorization fields, Bearer/Basic values, common API-key/access-token/token/password/secret assignments, sk-keys and URL userinfo. A real archive trigger canary test verifies local bearer/API-key/URL-password values are removed while the specific archive cause remains and length stays bounded.
- MaintenanceJob.lastError now stores the generic safe summary, so Host status no longer exposes private archive/commit details or arbitrary unknown transport strings. Runtime/notification messages stay generic. An unknown-transport secret-canary regression checks executor/model history, job JSON, runtime and public status.

This does not claim arbitrary strings can be universally identified as secrets. The critical boundary is refusing all untrusted unknown transport text; retained local error messages and known safe model error classes receive defensive redaction. Existing ModelClient forensic raw-response/checkpoint records remain governed by the approved M1 contract.

## Root full-suite compatibility failures

The root's completed final-tests.json/log supplied the initial RED evidence (1478 passed, 4 failed, 2 skipped). I did not rerun the full suite.

- memory-capacity-upgrade / legacy_evidence_and_done_payload: migration intentionally keeps computing visible for executor interruption accounting. Updated only that expected status to computing while retaining evidence conversion, terminal post-job compaction and idle-anchor assertions. Wrapped the file-backed DB in try/finally, so an assertion failure no longer leaves its handle open and causes the secondary Windows EPERM cleanup failure.
- memory-projection-retrieval / host restores frozen foreground before repair: its partial maintenance stub omitted takeError, causing the Host pump to throw before restoring the foreground; this was not a microtask race. Added the new error-state boundary members, captured onError and asserted no Host errors. Preserved exact resume-before-repair order, in-flight deferral and repair-once assertions. Added try/finally shutdown/close.
- memory-v3-recovery / ready rollback: the old saveJob mock threw on every write, including the newly required attempt/accounting writes, so it could neither reach the intended unit transaction nor permit the expected same-instance immediate retry. Replaced it with a real SQLite done-marker trigger, which fails after the owner update. The test now proves owner and marker rollback, durable ready payload/count/retry deadline, real disk reopen, waiting until the retry deadline, successful application exactly once and no model regeneration.
- memory-v3-recovery / index rollback: replaced the broad save mock with a real index done-marker trigger. The test proves vector rollback to zero rows, ready-result/retry-deadline retention, no early apply, and atomic vector-plus-done success after the deadline. Model is never called. Index computing-to-pending compatibility remains covered.
- Two existing maintenance tests asserted raw backend/capacity error wording in public lastError; they now assert the generic safe retry summary while retaining pending/not-paused/unchanged-preview/no-extra-request behavior. This matches the reviewed diagnostic privacy boundary.

## Verification

Logs are under .tmp/memory-retry-waking-20261013.

1. Focused review RED: `npm test -- tests/memory-maintenance-retry-limit.test.ts -t 'previously_consumed|immutable .*diagnostic|unknown_transport_secret|safe_model_request'` — 8 failed, 28 skipped, no collection error. Both consumed-fatal stops resolved incorrectly; public archive/commit/unknown-transport error text leaked; safe request diagnostic phase/detail was missing. Log task-2-review-red.log.
2. Focused review GREEN: same command — 8 passed, 28 skipped. Log task-2-review-green.log.
3. Compatibility GREEN: `npm test -- tests/memory-maintenance-retry-limit.test.ts tests/memory-capacity-upgrade.test.ts tests/memory-projection-retrieval.test.ts tests/memory-v3-recovery.test.ts tests/memory-idle-host.test.ts tests/memory-v3-maintenance.test.ts` — 72 tests / 6 files passed, exit 0; typecheck passed. Logs task-2-fix-compat-green.log and task-2-fix-typecheck.log.
4. Final stable scope after local-diagnostic redaction test: `npm test -- tests/memory-maintenance-retry-limit.test.ts tests/memory-capacity-upgrade.test.ts tests/memory-projection-retrieval.test.ts tests/memory-v3-recovery.test.ts tests/memory-maintenance-checkpoint.test.ts tests/memory-idle-host.test.ts tests/memory-idle-recovery.test.ts tests/memory-idle-fairness.test.ts tests/memory-v3-maintenance.test.ts tests/model-settings.test.ts tests/memory-capacity-prune-race.test.ts tests/model-run-history.test.ts` — **134 tests / 12 files passed**, exit 0 (11:04:06 run). Log task-2-fix-final-scoped.log.
5. Final `npm run typecheck` — exit 0, task-2-fix-typecheck-final.log. Final `git diff --check` — exit 0; only LF-to-CRLF checkout-policy notices for root-owned docs and the edited retry-limit test, no whitespace defects.

No source or test edits followed the final stable scope/typecheck; only this report was written. No unresolved concrete issue identified in this correction self-review. Independent re-review and the next stable whole-project gates remain root-owned; no full-suite/build/deployment result is claimed here.

## Final review7 compatibility correction (2026-10-13)

Root supplied the second stable full-suite RED at commit 367747a: 223 files, 1490 passed, 1 failed, 2 skipped; process settled before this edit. The sole failure was tests/review7-maintenance.test.ts expecting the private apply diagnostic in public job.lastError. The reviewed behavior intentionally keeps that field generic.

Changed only this test: expect the exact generic retry summary, then after successful delayed retry and lastError clearing, assert the immutable maintenance failure history still has category='apply' and error containing 'synthetic apply failure'. All partial-write rollback, saved-unit preservation, fairness for another ready job, deadline, early-retry exclusion and eventual success assertions remain intact. Whole-tests lastError search found no other maintenance raw-detail expectation requiring a change; passing tests were left alone. No product behavior changed.

Targeted GREEN: `npm test -- tests/review7-maintenance.test.ts` — 3 tests / 1 file passed, exit 0 (11:14:38 run). Log: .tmp/memory-retry-waking-20261013/task-2-review7-green.log. TEMP/TMP used the designated worktree directory. No full-suite/typecheck/build was rerun; root owns the next stable whole-project gates. Test process settled; no source/test edits followed verification. Product and tests are frozen for handoff.
