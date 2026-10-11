# M2-A independent review

Verdict: **PASS**

Reviewed the exact M2-A brief and implementation report against baseline `a8fb72d`, restricting implementation review to `src/memory/store.ts`, `src/memory/retrieval.ts`, `src/deployment/memory-runtime.ts` and `tests/memory-retrieval-vector-work.test.ts`. No actionable correctness or scope findings.

- `selectCandidates` retains vector reads by default. Its explicit false branch shares the same owners CTE and visibility bindings, omits the index join/vector column and keeps complete owner text. Existing permission checks and current revision/signature matching remain intact.
- `semanticCapability` is query independent and has no metrics mutations. `semanticPreflight` preserves `no_index → empty_query → uncalibrated → signature_mismatch`. Current build evaluates that before candidate SQL and passes the same capability to `buildFrozen`.
- Candidate compatibility remains after preflight and retains nonempty, dimension and finite-value requirements, plus the existing always-include and direct-alias exclusions. Skip metrics increment once in `buildFrozen`. Retrieval configuration shape, calibration defaults, ranking and limits are unchanged.
- Index registration explicitly requests complete owners without vectors; it is independent of the empty-query retrieval gate, preserving text and revision/signature registration.
- Tests cover the 1000 × 1024 unavailable/available paths, exact byte counters, one provider query for the calibrated path, reason priority, default API compatibility and permissions, all incompatible-candidate cases and complete four-kind registration without network calls.

Independent verification: ran the five required M2-A suites together with the six disjoint M1-B suites using workspace-local `TEMP`/`TMP` and `--maxWorkers=1 --no-isolate`. **11 files / 92 tests passed**, exit 0. M2-A's five-file subset accounts for 38 tests as reported. No full suite, formal database, network, timing benchmark, production edits or Git mutations were performed. Typecheck was not repeated during concurrent M2-B edits.

Scope limit: environment snapshot changes and frozen-policy serialization are the separate M2-B task and are not approved by this review.
