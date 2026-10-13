# Independent whole-branch review — memory retry and waking

Review base: b73023971d4050fddde0be0ec22779c316143399. Initial reviewed head: c60b20418bfa274d49960989af4cdf99bc19ae02. Reviewer: final_code_review, independent of the implementers. Initial status: changes requested. CURRENT APPROVAL: code spec, code quality, offline engineering acceptance and final offline factual documentation APPROVED through a4e781f. F1/F2 closed; formal deployment separate. Historical findings and closure evidence remain below.

## Findings

### F1 — P2: Preserve executor diagnostic errors beyond successful recovery

Location at c60b204: src/memory/maintenance.ts:63.

The immutable executor failure record stores `error:safeSummary`, so an archive or application exception is reduced to the same generic execution/retry message. The actual error exists only in mutable `MaintenanceJob.lastError`, which is cleared on successful retry or manual resume (lines 100, 265, 275). Unlike model transport/parse failures, archive and application failures have no separate detailed ModelClient record. Consequently the approved error-history contract loses the reason for precisely the R2 failures this change is meant to retain.

Confirmed with an independent in-memory SQLite probe: seed a ready job and checkpoint; install a checkpoint INSERT trigger raising `specific archive failure`; call applyOneReady; remove trigger, advance five minutes, call again. Before retry lastError is `specific archive failure`; after retry status is done and lastError is null, while the only immutable failure is `{stage:'maintenance',category:'execution',error:'记忆整合执行失败，等待重试'}`. No model, network, file database, service, configuration, or production data was used.

Preserve useful credential-safe executor diagnostics and distinguish archive/application/preparation context in history. Keep runtime/public safeSummary generic, and continue to avoid copying arbitrary transport/authentication details. Add regression assertions covering successful retry and resume/reopen.

### F2 — P2: Latched storage fault must still fail a later graceful stop

Cross-reference to the independent M2 review, reported by root: src/host/runtime.ts:167-170 at c60b204. When pump has already consumed/logged a fatal maintenance storage error, the maintenance queue is empty and later graceful stop resolves even though hasStorageFault remains true and work remains computing. M2 reviewer has a confirming synthetic probe. This reviewer independently inspected the queue drain and fault latch and agrees with the failure path; did not duplicate the execution probe. Awaiting corrective delta and regression evidence.

## Spec and integration assessment

The implementation otherwise follows the original plan plus R1-R4 amendments in the inspected code:

- Dedicated persisted maintenancePause ownership survives foreground lastFailure replacement. Failed jobs reserve their objects in both incremental and daily selection, and are excluded from dispatch. Manual resume targets the recorded owner/cycle and preserves run and repair/tool budgets.
- Attempt accounting begins before dispatch, persists across computing interruption and disk reopen, and adopts the one observed legacy execution as 1 execution/1 failure while marking older history unknown. Successful preparation and intermediate units do not reset failures or replenish attempts.
- Ready output is saved before checkpoint archival, and archive errors are caught inside prepare/application. Retrying the saved result does not regenerate a model result. Failure settlement is guarded by attemptId/settledAttemptId. Storage accounting faults latch local dispatch shutdown even if paused cannot be written.
- Terminal notice claim is durable before logging/sending; attempts are at most once per cycle, including sender failure and reopening. This is not a crash-proof delivery guarantee. Host serializes the notice after the foreground turn.
- Failure invocation UUIDs are independent of business runId, preserving final invalid raw responses and distinct resumed calls. All destructive checkpoint-to-NULL paths found by source search use archive-before-clear savepoints. History has no automatic retrieval integration, material references remain intact, and read-only Storage does not create the new table.
- Waking narrative receives the original sleep window. Personal input clears only an ended window, and the next night's schedule remains. Existing school validation still rejects the half-open sleep interval, early release/publication, future experiences and forbidden phone access, while permitting valid pre-sleep and exact-wake-time reading. Disk-recovery tests retain the same narrative run and exhausted repair budget, including sealed/attempted output cases.
- Settings retain 600000 ms consolidation/audit versus 120000 ms index timeout and 300000 ms retry wait; repair limit, Web budgets, protocol versions and dependencies are unchanged.

## Review method and current evidence limits

Read the immutable original plan and plan review, the entire committed source change in manageable passes, full maintenance/Host/ModelClient/history implementations, relevant unchanged school/time/phase/compaction/production wiring, and added/adjusted tests. Read task reports and M1 approval. Performed focused searches for checkpoint clearing, history retrieval and runtime writes, plus the independent in-memory diagnostic-loss probe above.

No full tests were run by this reviewer; root owns stable whole-branch validation and will supply final typecheck/build/test/demo/plugin results. The committed code review is complete apart from rechecking the forthcoming correction. Current documentation work is separately in progress and will be checked once finalized. Original plan/review evidence and source files were not edited. The only reviewer-authored file is this report.

The pre-existing expected-negative CLI stack trace is acknowledged as P3 test-output noise, not a new product blocker.

## Initial verdict at c60b204

Spec compliance: not yet complete because F1 loses required durable error content. Quality: changes requested for F1 and the independently reported F2. No additional concrete blocking finding identified in the remaining inspected implementation. Final approval is pending both closures and final stable evidence/documentation.

## Frozen documentation review

Reviewed all ten current-document working diffs, the new record README/DELIVERY/REVIEW_CLOSURE, the link-checker source and task-4 report after root declared this content frozen. Behavior prose correctly distinguishes audit prompt/context from actual memory_consolidation task routing; legacy observed execution 1/1 from unknown earlier history; notification attempt from delivery guarantee; live checkpoint recovery from forensic history; and pre-sleep permission from the half-open sleeping interval. The provisional final acceptance/deployment/Git status is intentional and must be replaced only with actual root evidence. No independent documentation blocker was found beyond the implementation findings F1/F2 and those outstanding facts.

Independent documentation checks: checker reported 13 documents, 420 local links, zero failures and zero pending paths (called with --allow-pending); scoped docs git diff --check had no defects, only normal LF-to-CRLF policy warnings. The checker skips examples/story.sample.json and runtime/archive/README.md and does not inspect private configuration or data. Original plan/review bodies remain immutable inputs.

## Corrective delta closure — 367747a6ca9c587e18d0eb069af8e474b479fd4a

Independently read the complete c60b204..367747a source/test diff, task-2-fix-report, relevant test bodies, final scoped log (12 files / 134 tests passed), and final typecheck log. No source/test edits occurred during this review, and no redundant test run was started while root's whole-project pipeline was active.

F1 CLOSED. `failureDiagnostic` and FailurePhase now separate prepare/archive/apply from timeout/interrupted, retain bounded local archive/application Error.message in immutable history, and keep public job/runtime summaries generic. Unknown preparation/transport errors are deliberately generic; known sanitized model errors retain classification, and local details receive credential redaction without serializing arbitrary stacks/causes/objects. The prepare and saved-result application paths set the phase before the failing operation and still charge only one settled attempt. Four real SQLite trigger cases verify specific archive/commit diagnostics survive retry or terminal/manual-resume to done with a single model request. Additional tests cover unknown transport secret exclusion, retained safe request classification, local credential canaries and size bounds. This meets the diagnostic-retention correction without exposing those private details through public status.

F2 CLOSED. MemoryMaintenance retains the first fatal Error independently of its finite queue. Host checks this retained storageError only after every drain and error queue has been handled, and deduplicates an already-queued same Error by identity. The new two ordering cases first consume/log all fatal errors (including the variant where paused cannot persist), then prove graceful stop remains pending until both background and environment drains complete and finally rejects. Existing successful drain/reliably accounted retryable-error semantics remain covered and unchanged.

Compatibility test fixes are appropriate, not weakened acceptance: migration now deliberately preserves computing for interruption accounting; a partial Host stub implements the newly required boundary and asserts no pump errors; real SQLite done-marker failures replace broad saveJob mocks and prove owner/vector rollback, persisted retry delay, maintenance disk reopen, exactly-once application and zero model regeneration. Generic public-error assertions match the corrected privacy contract.

Final CODE spec verdict: APPROVED. Final CODE quality verdict: APPROVED. No unresolved concrete P1/P2 or new code finding remains in the complete reviewed range b730239..367747a. Initial findings and reproductions above remain as the audit trail. Whole-engineering acceptance is still pending root's final stable typecheck/build/full-suite/demo/plugin results and factual documentation updates; this code approval is not deployment, startup or resume authorization.

## Test-only follow-up — a4e781f0d671bb122e9d42684f76a32ca2222fa8

Independently reviewed the exact 367747a..a4e781f diff and task-2-review7-green.log (1 file / 3 tests passed). The only change imports ModelRunHistory, updates an old public lastError expectation to the safe summary, and adds an assertion that the specific apply diagnostic remains in immutable history after successful retry. The existing partial-unit rollback, other-ready-job progress, exact retry deadline and successful application assertions are preserved. Product/source/runtime/scripts/package/tsconfig diff from 367747a is empty. Test delta APPROVED; code spec/quality approval therefore extends through a4e781f. Root's final whole-engineering pipeline is still pending.

## Final engineering acceptance — a4e781f0d671bb122e9d42684f76a32ca2222fa8

Independently inspected public evidence/final-checks.json, the aggregate and per-file results in evidence/final-tests.json, and all six logs/final-*.txt. All recorded exit codes are 0. The stable full suite contains 223 file results, 1493 total tests: 1491 passed, 0 failed, 2 skipped; zero failed files and success=true. JSON reports 229 suites because suite count is not file count. Typecheck and build passed. Demo completed using simulated QQ without an external model or formal database. The separate plugin contract/build-path gate passed 2 files / 10 tests. Runtime plugin-smoke recorded empty_week and required_notice, each with four committed steps, one embedding call and no repairs.

The visible Stop HDSI / --stopped stack trace in the full-test log belongs to the already-reviewed expected-negative CLI case; the structured results confirm no failed test. It remains a pre-existing nonblocking output-noise observation.

CURRENT ENGINEERING VERDICT: APPROVED for the complete reviewed branch through a4e781f. F1/F2 are closed, code spec/quality are approved, and final stable offline gates are green. Final factual documentation wording is receiving a brief final check. Formal deployment is root-owned and remains separate; this review does not claim online-model quality, real QQ delivery, a service startup/resume, production schema initialization, or a completed deployment.

## Final documentation closure and overall verdict

Reviewed finalized current-document/record wording against the actual a4e781f engineering results. The source/acceptance baselines, test totals, model/task naming, private diagnostic versus public summary boundary, retained storage fault, R1-R4 and F1/F2 closures are consistent. A minor evidence-description overstatement in the F1 closure row was corrected: its in-memory trigger tests establish detail retention through retry/manual resume; existing file-database tests separately establish history/ready recovery. This does not change the product or the approved tests.

Independent final strict link check: 13 Markdown documents, 435 local links, zero failures, zero pending paths (no --allow-pending). Scoped documentation whitespace check passed with only checkout-policy LF-to-CRLF notices. Original plan/review and initial negative findings remain historical inputs/evidence. Root owns the separate deployment/Git factual table and any later production checks; no completed deployment, startup or resume is claimed by this review.

FINAL VERDICT: APPROVED — code specification, code quality, complete offline engineering acceptance, and finalized offline factual documentation. No unresolved blocking finding remains in this review. Public review copies should include this closure and the CURRENT APPROVAL at the top.
