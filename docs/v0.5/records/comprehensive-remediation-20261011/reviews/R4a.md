# R4a independent review

Verdict: **PASS**. No actionable correctness or specification finding in the reviewed R4a changes.

Reviewed 2026-10-11 against the exact `R4a-brief.md`, `R4a-report.md`, and current HEAD `f33de815a3f23835a1b73a7e836d58be28dd6f67`. Scope is the report's R4a production/test files and plugin smoke business assertions. Concurrent M-D/Q1 work and other documentation changes are outside this verdict. No product source or Git state was changed by this review.

## Specification and quality checks

- `src/environment/payload-compaction.ts:7` gates strictly on preparationVersion 1 and committed/superseded status. It clears exactly the three preparation payload fields, preserves row metadata/extensions, produces only fixed stage-specific ID/count keys, retains frozen result order, and derives digests from frozen data without querying live state. Applicable empty school-week required notice IDs remain `[]`; missing results remain null. Repeated fully compacted rows return null and retain compactedAt. Unknown top-level audit extensions survive recomputation.
- `src/environment/digest.ts:3` preserves the prior canonical SHA-256 implementation exactly; `src/environment/snapshot.ts:1` imports and reexports it without introducing a payload-to-snapshot runtime dependency. R3 pending-task behavior and M2B semantic-policy freezing are unchanged from HEAD.
- `src/environment/runtime.ts:54` applies formal event/school writes before saving the compacted committed row in the existing caller transaction. Fault injection at formal-event and terminal-step writes proves rollback of both business changes and terminal compaction, leaving the same ready result reusable with no extra generation and exactly one eventual entity commit.
- `src/environment/preparation.ts:40` rereads the latest row inside the cleanup transaction and excludes the same active step. `applyReady` at line 134 rejects a ready-but-active execution; synchronous helper calls cannot interleave after that guard. Tests exercise the ready publication boundary directly.
- Observed IDs at `src/environment/preparation.ts:14`, 29, 96 and 137 cover started and recovered active-batch steps. Reconciliation rereads those IDs after scheduler supersede, including when firstActiveBatch has moved; the cross-day applyReady early return runs reconciliation. Active IDs remain protected until finally clears active. Final cleanup failures enter the existing error queue and the Host wake is still issued. IDs are removed only after successful terminal cleanup; repeated cleanup causes zero saveStep calls. No historical terminal scan is added.
- Legacy preparation-version 0/missing rows retain full payloads even when input modelContractVersion is 1. The school-week contract, world/school recovery and legacy calendar tests retain their old terminal-payload assertions. W5's formatVersion 2 fixture remains intact.
- `tests/environment-async-phases.test.ts` checks input relationships before commit and audit/formal rows after commit. `tests/environment-async-recovery.test.ts` proves disk-ready payload retention, matching pre-reopen result digest, identical committed event ID and zero additional model calls. The new tests also cover deferred noncooperative web-backed execution, rejected late publication, unobserved historical superseded payload retention after reopen, all four stages and both terminal states, metadata/error retention and a one-shot v1 runner.
- `runtime/plugin-smoke.cjs:37` requires v1 audits and null terminal payloads, empty-week notice counts, matching audit/persisted notice IDs and captured required-notice IDs. Persisted notice validation and school-instance checks remain. V0 isolated-build dispatch and `runtime/plugin-smoke-fixtures.cjs` are unchanged. This was static inspection; actual plugin smoke belongs to the parent's integration gate.

## Independent verification

Ran with TEMP/TMP `D:/HDSI-remake/.tmp/comprehensive-remediation-tests`:

```text
npx vitest run tests/environment-payload-compaction.test.ts tests/environment-async-phases.test.ts tests/environment-async-recovery.test.ts tests/environment-async-host-gates.test.ts tests/environment-async-boundaries.test.ts tests/school-week-contract-recovery.test.ts tests/world-school-batch.test.ts tests/world-school-review14-contracts.test.ts tests/world-school-review14-calendar.test.ts tests/memory-access-work-probe.test.ts --maxWorkers=1 --no-isolate
```

Result: **10 files / 84 tests passed, exit 0** (the specified R4a 9 files / 81 tests plus M-D's 3 corrected probe unit tests). The 22 new compaction tests independently check exact audit content/digests, >=95% reduction on the fixed 100 × 4KiB fixture with vectors, and constant compacted size when candidate payloads double. These are fixture assertions, not formal-database size or performance claims. `git diff --check` reported no whitespace errors; only existing line-ending notices appeared.

The report's earlier typecheck failure was attributed to a concurrently absent Q1 module. This reviewer did not rerun broad typecheck or use that transient failure as evidence against R4a. Full suite, typecheck after all concurrent work, isolated build and both plugin smoke scenarios remain parent-owned. R4b handles historical rows; W7 owns web owner operation draining/finalization. No formal database, network, browser, official timing CLI, full suite, build or smoke run was performed here.
