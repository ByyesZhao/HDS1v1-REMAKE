# M1-C independent review

Verdict: **PASS** (implementation and focused tests).

Reviewed 2026-10-11 against `.superpowers/sdd/README/M1-C-brief.md` and `M1-C-report.md`, with root-provided HEAD `305db52` plus current `src/memory/cleanup.ts` and `tests/memory-cleanup-policy-work.test.ts`. Compared the previous cleanup implementation and inspected policy snapshot/order, capacity, summary-repair, and store owner/purge interfaces. No actionable correctness or scope issue found.

## Spec and quality findings

- Expired short eligibility retains the old active/expiry rules, including merged-active and capacity-exited shorts; `hasContent` and repair predicates match the dedicated projection contract. No-source, blank-short, merged-short, durable-long, and unchanged repair-basis cases are exercised.
- `nextDeadline` retains metadata canonical resolution; `applyOne` retains owner canonical resolution. Protection always uses metadata mode. Cross-table duplicate-ID behavior and canonical repair chains are explicitly tested.
- Old-owner references include every short and direct canonical/evidence references from active learned rows. Deletion priority remains expired short, old owner, then archives. Unprotected overdue archives exclude young overflow archives while any overdue candidate remains. One call purges one owner.
- Blocked IDs retain original strings/order and the protected-archive marker. Deadline overflow branches retain their historical merged-active exceptions; future deadline selection preserves the original string for tied epochs.
- Repair hydrates the selected short and resolved long through two actual owner reads. The saved short contains its original real body, topics, summaries and source IDs; version/basis update prevents unchanged repeated work. Projection rows are never saved or queued as full owners.
- Each synchronous operation owns one local snapshot. Capacity fallback reuses it; no cross-call cache is introduced. Gates execute before snapshot reads. Unordered deadline checks require no awakening reads. Skipping archive sorting when a preceding short/old owner will be purged is observationally equivalent and avoids unnecessary work.

## Independent verification

Executed with `TEMP` and `TMP` set to `D:/HDSI-remake/.tmp/comprehensive-remediation-tests`:

`npx vitest run tests/memory-cleanup-policy-work.test.ts tests/memory-capacity-cleanup.test.ts tests/memory-cleanup-write-amplification.test.ts tests/memory-capacity-prune-race.test.ts tests/memory-capacity-idle-integration.test.ts tests/memory-access-work-probe.test.ts --maxWorkers=1 --no-isolate`

Result: **6 files, 46 tests passed**, exit 0 (cleanup subset: 5 files / 44 cases). Existing `m1c-focused-final.txt` and `m1c-typecheck.txt` were also read and agree with the implementation report; typecheck was not rerun by this reviewer.

No product edits, Git mutations, full suite, build, real data, browser, external network request, or accepted timing run were performed. Unit-probe elapsed times are not performance acceptance evidence. M-D timing/documentation remains root-owned and does not block this scoped M1-C PASS.
