# Task 1 review — M1 persistent model history

## Spec compliance

**Verdict: compliant for M1.** Reviewed `821e23012d6f99b417a55a50bdd5a10674cb8a50..86eebb8abcafc8c4ad62c1d49ae731fb837f711e`. No blocking missing, extra, or misunderstood M1 requirement found.

- `src/model/client.ts:30,46,66,80` creates a fresh invocation UUID, retains run/stage identity, captures transport errors and every format failure before the repair-budget test, and saves the actual final invalid raw. `tests/model-run-history.test.ts:25,31,65` covers budget exhaustion, foreground reinvocation, and reopening without identity collisions. The optional execution-attempt metadata does not enter CompletionRequest.
- `src/model/run-history.ts:15-24` uses immutable inserts and content/reason-based archive identities. `src/model/run-history.ts:32-43`, `src/web/store.ts:69-74`, `src/memory/store.ts:174-181`, and `src/memory/payload-compaction.ts:47` put checkpoint archival and clearing inside savepoints; maintenance done-save also rolls its job write back. The new real SQLite trigger tests cover all four clearing entrypoints (`tests/model-run-history.test.ts:36,47`).
- `src/storage.ts:27-35` adds only the history table after the read-only early return; the history constructor has no DDL (`src/model/run-history.ts:14`). The explicit writable legacy CLI initialization is justified (`src/deployment/memory-payload-compaction.ts:16`); dry-run and launcher read-only tests exercise missing history schema.
- `src/deployment/plugin-runtime.ts:83` injects persistent history independently of web enablement/provider availability. No protocol/version/budget changes appear in this diff; repairLimit remains 2 and web defaults remain 20/40 (`src/model/client.ts:27`, `src/web/types.ts:26`).
- `src/model/run-history.ts:26-29` exposes explicit forensic reads only. No automatic retrieval call site was found. Raw checkpoints and their material identifiers are preserved; archival changes no material/operation/observation rows. Reference and fresh-context isolation assertions are present (`tests/model-run-history.test.ts:75,86`).

## Strengths

- The same archive helper governs all four destructive checkpoint paths, and it fails closed when a legacy caller lacks the new schema (`src/model/run-history.ts:38-43`).
- Failure identity is independent of both business-run identity and maintenance-attempt identity, addressing the foreground recovery collision explicitly (`src/model/client.ts:30`, `src/model/run-history.ts:19-20`).
- Tests exercise actual persistent SQLite writes, rollback triggers, old read-only databases, immutable duplicate IDs, final invalid drafts, and reference resolution rather than asserting only mock calls (`tests/model-run-history.test.ts:23-116`).
- Archive-reason plumbing consistently distinguishes generation replacement and environment supersession from completion (`src/app.ts:67`, `src/environment/preparation.ts:54`, `src/environment/runtime.ts:29-48`).

## Issues

### Critical / Important

None found within M1 scope.

### Minor

**P3 — Existing negative CLI case prints an expected stack trace into the green run.** `tests/memory-payload-compaction-cli.test.ts:40,44` invokes the intentional missing-`--stopped` failure without capturing stderr. The final scoped log contains `Error: Stop HDSI and supply --stopped before payload compaction` at line 10 despite 99 passing tests. This is pre-existing test-output noise, not a product regression or a blocker for M1. Capture stderr for that invocation and assert the expected diagnostic, as the earlier CLI case already does at line 20, so real failures remain easy to spot.

## Checks and limits

- Read the supplied full diff package in passes because the initial tool response was truncated. Completed missing hunks from that package; inspected full ModelClient/payload helper context where the supplied output cut functions off. Read-only Git inspection confirmed the requested range and clean checkout; no Git state was changed.
- Named risk: a destructive checkpoint bypass or cleanup of material references. A focused `rg` search for checkpoint clearing/deletion and history use found only the shared archive helper executing checkpoint-to-NULL mutation; payload-compaction's remaining SQL literal is a spec selector, not an executed bypass.
- Named risk: executionAttempt metadata loss or archive hydration changes through the unchanged decoder. Inspected `src/web/persistence.ts:8-11`; version-2 checkpoints retain metadata, and legacy conversion remains the existing behavior.
- Named risk: production history being gated on web availability. Checked `src/deployment/web-runtime.ts:8` together with the plugin injection hunk; web construction and ModelClient history injection are independent of provider presence.
- Read existing evidence: `.tmp/memory-retry-waking-20261013/task-1-final-scoped.log` reports 11 files / 99 tests passed; final typecheck and build logs contain their successful compiler invocations. No tests were rerun: review found no unresolved behavioral doubt requiring a new probe.

## Declined to judge / integration obligations

- Maintenance finite retries, executor timeout/interruption/commit-failure recording, attempt lifecycle, finalizer error delivery and Host pauses belong to M2 per the explicit task split. M1 exposes `recordFailure` and optional `executionAttempt`; root must verify those integrations after M2 (`src/model/run-history.ts:19`, `src/memory/types.ts:52`).
- Whole-branch full-suite/demo/plugin/deployment acceptance remains root-owned after M2/W1. The reported earlier full-suite run overlapped edits and is not final acceptance evidence.
- Existing image-asset retention is intentionally unchanged; retained observation metadata does not establish permanent image-pixel retention.

## Quality assessment

**Task quality: Approved.** The M1 implementation meets its scoped retention and compatibility contracts with meaningful regression coverage. No M1 correction is required before continuing to M2; final branch acceptance still requires the integration obligations above.
