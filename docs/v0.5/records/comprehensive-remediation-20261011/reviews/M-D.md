# M-D independent review

Verdict: **PASS for probe code after correction**. The previous probe correctness finding is resolved. The overall M-D task remains pending official before/after measurements and final acceptance gates; this review makes no official timing claim.

## Correction re-review (2026-10-11)

Independently inspected the corrected source against current HEAD `f33de815a3f23835a1b73a7e836d58be28dd6f67`. `scripts/check-memory-access-work.ts:57` records the path passed to each actual Storage constructor; line 77 supplies a counted rejecting `models.runModel` dependency; lines 91–103 count attempted fetch/socket calls before throwing, check the counters after every completed warmup/sample, and restore both global hooks in `finally`. Report fields now come from those counters and the observed constructor arguments. The counted offline embedding provider remains separate from the forbidden model runner.

The adversarial test at `tests/memory-access-work-probe.test.ts:30` injects a guarded fetch into the real retrieval build, deliberately swallows the guard error, and requires the public probe to reject while restoring the original fetch hook. Inspected `md-review-red.txt` (the old probe incorrectly resolved) and `md-review-green.txt` (all 3 probe tests passed). Independently reran all 3 probe unit tests together with the 9-file R4a focused suite: **10 files / 84 tests passed, exit 0**, with TEMP/TMP set to `D:/HDSI-remake/.tmp/comprehensive-remediation-tests`. This includes all 3 M-D unit tests and the adversarial correction. No official before/after CLI measurement was run or timing result accepted.

The original finding and initial review evidence below are retained as review history. Its fixed-zero/swallowed-attempt concern no longer applies to the corrected probe. Official identical-probe baseline/current measurements and any final accepted documentation review remain parent-owned.

Reviewed 2026-10-11 against `.superpowers/sdd/README/M-D-brief.md`, current `scripts/check-memory-access-work.ts`, `tests/memory-access-work-probe.test.ts`, and the small source-identity addition in `scripts/check-image-payload-work.ts`. Root-provided current HEAD: `305db52`. Actual archived baseline inspected: `.tmp/comprehensive-remediation-baseline/source-revision.txt` = `9c20a97f632d9eaf5781973fefab95619eb7dc3a`.

## Original required change — resolved

**[P2] Measure and enforce network/storage/model claims instead of emitting fixed zeros.** `runMemoryAccessProbe` replaces `fetch` and `Socket.prototype.connect` with a throwing function, but does not count attempts or check for them after work completes. Its `networkRequests:0`, `modelCalls:0`, and `storagePaths:[':memory:']` report fields are constants. Code such as the existing index error handler can swallow a thrown request error, allowing the probe to succeed and claim no network attempts. The network test's fetch spy is replaced by the probe's guard, so its `not.toHaveBeenCalled()` assertion cannot establish absence of attempts.

Independent minimal reproduction: `.tmp/comprehensive-remediation-tests/md-review-network-repro.ts` wraps the real `MemoryRetrieval.build`, calls guarded `fetch` once per invocation, catches the error, and then invokes the real build. Running it through the public probe with one scenario/size returned:

`{"attempted":8,"reportedNetworkRequests":0,"probeSucceeded":true}`

All eight attempts were intercepted locally; no external request was sent. These are one warmup plus seven samples. Increment a measured attempt counter before throwing, fail the probe if any attempt occurred even if product code swallowed the exception, record actual constructor paths, and use counted rejecting model stubs at the exercised dependency boundary. Add an adversarial test covering a swallowed guard exception; keep restoration of global hooks in `finally`.

## Checks that passed

- Each warmup/sample constructs a fresh `Storage(':memory:')`, store, fixture and index. Instrumentation begins after fixture creation, counters reset per sample, and overflow remains independently seeded at 100 shorts / 1001 active longs / 500 archives. Seven sample work/outcome/snapshot-byte records must match.
- Both source versions are accessed through shared capacity, cleanup, retrieval and freeze APIs. There is no new policy-helper dependency in the probe. Baseline is loaded from its actual archived source path; the source-revision marker takes precedence over the enclosing repository HEAD.
- SQL counter patterns cover actual baseline/current `SELECT data FROM` full-owner reads and the retrieval `WITH owners AS` / `SELECT o.data,i.vector` join, metadata projections, awakening queries, and owner/grant/dirty mutations. Vector bytes come from returned BLOB lengths; query calls and offline provider calls are observed, not inferred from candidate counts. These counters describe returned BLOB bytes, rather than CPU decoding cost.
- Report includes complete seven samples, median, fixture/pool/text information, source file hashes, probe hash, Node/platform identity, and measured serialized frozen bytes. Explicit CLI output path is required.
- Image probe addition hashes the selected source tree and executing probe, preserving the existing source marker/HEAD behavior. The added hashes disambiguate dirty current sources without changing the timed operation. No issue found in that small addition.

## Verification and remaining acceptance

Independent focused run: `npx vitest run tests/memory-cleanup-policy-work.test.ts tests/memory-capacity-cleanup.test.ts tests/memory-cleanup-write-amplification.test.ts tests/memory-capacity-prune-race.test.ts tests/memory-capacity-idle-integration.test.ts tests/memory-access-work-probe.test.ts --maxWorkers=1 --no-isolate`: **6 files / 46 tests passed**, exit 0. Existing `md-green.txt` reports the original 2 probe tests passed. The adversarial reproduction demonstrates their missing assertion despite that green result.

No official seven-sample before/after acceptance measurement, baseline execution, broad typecheck, full suite or build was performed by this reviewer. Root must still obtain identical-probe baseline/current measurements in a quiet window, compare work/outcomes and medians, explain any regression/text sensitivity, update accepted MEMORY/RECOVERY documentation, and run remaining delivery gates. A corrected probe code PASS alone will not complete M-D.
