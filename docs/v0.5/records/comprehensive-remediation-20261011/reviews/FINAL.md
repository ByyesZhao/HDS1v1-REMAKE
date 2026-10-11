# Final independent branch integration review

Date: 2026-10-11. Reviewer scope: `9c20a97..f60afa622543f126c9d25919989b11b37dc6b48c` in `D:/HDSI-remake`.

Method: the `superpowers:requesting-code-review` code-reviewer template, applied directly by this reviewer without delegation. The product checkout, index, HEAD and branch were read-only. This report is the only reviewer-authored file. I read the actual production diff and surrounding callers, not only task reports. Uncommitted Q3 changes were inspected for their shared Q1/Q2 interface boundary; their detailed acceptance belongs to the separate Q3 reviewer. Documentation closeout belongs to the separate documentation reviewer.

## Strengths

- **Host task projection and pause contract:** `src/host/task-projection.ts:6` is shared by sleep planning and transactional postprocessing. Consumption is decided against original rows and the frozen turn time; metadata-only/same-epoch/past updates cannot reactivate a consumed task. `src/host/runtime.ts:67` and `:81` check pause after both awaited selection APIs. `src/host/scheduler.ts` keeps the pending-task cache local to one synchronous evaluation and invalidates it after task writes. SQL pending selection preserves rowid order. I inspected the real Host, old frozen candidate, transactional failure/reopen, shared-task and pause-boundary tests.
- **W4/W5 persistence and full-content behavior:** control reads project metadata, while `src/model/client.ts:34` owns full run materials locally. Lines 36–42 validate durable references before the initial checkpoint save or new provider work. Partial operation recovery passes the same run-bound material pool to the service, which loads only missing material IDs. The v1 codecs preserve recovery fields, repair state and historical tool counters; completed operation replay returns current outer counters. Explicit migration verifies references and embedded-material equality inside caller-owned bounded batch transactions. It does not perform terminal cleanup. Materials remain full text, including literal markup-looking text from the browser's text adapter.
- **R4 plus W7 ordering:** `src/environment/preparation.ts:120` clears the execution lease in finally and schedules terminal cleanup on the execution's settled continuation. `applyReady` excludes the active step. Terminal compaction therefore cannot race the same step's generator/finally. `src/web/service.ts:74` waits for the owner's web locks and clears cache/checkpoints without deleting materials, operations, sources or counters. `src/environment/preparation.ts:181` drains finalizations as well as active generation. Pending/retry/stop retain recovery payloads. `src/host/runtime.ts:148` drains all shutdown work before exposing cleanup errors; the deployment wrapper preserves the media/browser/storage release ordering. Inspected fault, delayed-provider, supersession, old-v0 and temporary-runner tests support these interactions.
- **M1 lifecycle and work budgets:** the explicit policy snapshot contains predicates rather than placeholder body owners. Canonical lookup retains separate metadata and owner resolution semantics. Capacity reads full owners only for selected mutations, updates the same local snapshot after writes, and retains temporary protection. `src/memory/capacity.ts:60` keeps the background budget-one short/long pair atomic while allowing foreground Infinity processing. Cleanup keeps the short → old owner → archive priority, reference blocking and one-unit semantics; nextDeadline performs no archive sorting or awakening reads. Pure numeric sort keys preserve epoch comparisons and the original tie order. Inspected the work-budget and same-canonical/multiple-short regressions.
- **M2 current/frozen distinction:** `src/memory/retrieval.ts:38` gates vector joins by actual query capability before candidate reads. `src/environment/snapshot.ts:49` freezes vectors by query-independent capability, so an empty initial setting does not disable a later valid semantic lookup. The existing configuration digest remains unchanged, legacy snapshots are accepted, and signature/dimension changes are rejected before vector conversion. Actual retrieval remains the source of Q1/Q2 metrics; the runtime default at `src/memory/retrieval.ts:15` is still lexical 1/1 with semantic null.
- **Image and CLI lifetimes:** `src/input-media/assets.ts:55` claims the use count before disk I/O; shared leases retain bytes and lazily memoize one data URL. `src/input-media/service.ts:30` tracks the entire preparation, including file acquisition, and releases its lease in finally. Shutdown waits for accepted preparations. The independent sticker runtime owns startup/disposal work, while rebuild bypasses unnecessary browser/model assembly. Reviewed actual transport, cached/missing-file, concurrent lease, abort and shutdown tests.
- **Q1/Q2 and Q3 boundary:** inspected the committed evaluator and lexical CLI plus the uncommitted shared-interface diff. Evaluation uses real MemoryRetrieval/ContextBuilder and personal input assembly; selection projects calibration families before fitting. Candidate bytes are frozen before the exclusive holdout-use claim. Q3's shared path adds vector-pack validation and explicit missing-vector failure without changing runtime defaults or introducing a runtime dependency on evaluation tooling. Detailed Q3 vector collection/replay correctness remains subject to its independent review.

## Issues

### Critical (Must Fix)

None confirmed.

### Important (Should Fix)

None confirmed in the reviewed committed product range or inspected Q1/Q2 integration boundary.

### Minor (Nice to Have)

None raised. I did not manufacture style findings or turn pending parent-owned delivery work into product defects.

## Verification evidence and limits

- Read `git diff --stat 9c20a97 f60afa6`, the production diffs across `src`, deployment/CLI changes and Q1/Q2 evaluator source, plus affected test source and prior independent W5/W7/Q2 review evidence.
- Confirmed HEAD remained `f60afa622543f126c9d25919989b11b37dc6b48c` during the review. The worktree contained the disclosed Q3 and documentation closeout changes; they were not reset or edited.
- **No tests were executed by this final reviewer.** Root explicitly requested static review while its isolated typecheck/build/full-suite gates were running, to avoid Windows temporary-directory contention. Existing task-review passing logs were used as supporting context, not presented as executions by this reviewer.
- No full suite, typecheck, build, smoke, deployment, service stop/start, private config/database read, external provider request, main retrieval evaluation or holdout evaluation was performed. Final engineering and deployment gate results must be reported by root separately.

## Recommendations

Accept the independent Q3 and documentation reviews, then record root's final isolated typecheck/build/full/demo/plugin-smoke and deployment decisions against the final integrated commit. Preserve the distinction between code acceptance, explicit old-payload migration, actual deployment, and unexecuted online semantic quality research. Do not re-run or reinterpret the previously claimed Q2 holdout as unseen data.

## Declined to judge

- Formal database migration/compaction and service deployment: prohibited for this review and owned by root's delivery gate; no live outcome is inferred from synthetic evidence.
- Real provider semantic quality, new production calibration and online browser reliability: intentionally outside this offline product remediation acceptance; Q3 tooling and a synthetic replay do not establish these outcomes.
- Detailed uncommitted Q3 collector/replay implementation: assigned to the independent Q3 review; this review checked only its Q1/Q2 and runtime-default integration boundary.
- Final uncommitted documentation closure matrix and link completeness: assigned to the independent documentation review and still being completed during this review.
- Whole-suite/build/smoke success at the final integrated HEAD: root-owned gate, not executed by this reviewer. Prior per-task passes do not replace it.
- Arbitrary malformed databases, adversarial inputs, and generalized security hardening: outside the agreed normal-business/performance scope; no new requirement was inferred from those hypothetical cases.

## Assessment

**Ready to merge? Yes for the reviewed committed code range, with the separate Q3/documentation acceptance and root's final engineering gates still required before declaring the entire delivery complete.**

**Reasoning:** No new actionable integration defect was confirmed after inspecting the actual source changes and the cross-task recovery/lifecycle boundaries. This is a static independent integration PASS, not a claim that this reviewer ran the full suite or that production deployment, historical payload migration, or online semantic quality validation has completed.
