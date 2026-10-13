# W1 independent spec and quality review

Reviewed: 2026-10-13

Scope: `86eebb8abcafc8c4ad62c1d49ae731fb837f711e..b6f792234dedcb6e88ebe9dd6b931d6a98b407f6`, branch `codex/waking-time-boundary-20261013`, worktree `C:/Users/<user>/.codex/worktrees/waking-time-boundary/HDSI-remake`.

## Verdict

- Spec: PASS. Implements W1 including approved R3 and both acceptance clarifications.
- Quality: PASS after the formatting-only follow-up `49e424759fca69c155a428999703398ab2ebb1df`. No open findings; the original P3 is retained below with closure evidence.
- W1 is ready for root-owned integration and final integration acceptance. This is not approval of M2, deployment, startup, or resume.

## Findings

### P3 — Remove the added final blank line (CLOSED)

Location: `tests/waking-school-notice.test.ts:115`.

The committed file ends with a newly added blank line. A fresh review command, `git diff --check 86eebb8abcafc8c4ad62c1d49ae731fb837f711e b6f792234dedcb6e88ebe9dd6b931d6a98b407f6`, exits 1 and reports `tests/waking-school-notice.test.ts:115: new blank line at EOF.` This contradicts the task report's final whitespace-cleanup statement and would fail the planned integration diff check. Remove the extra blank line while retaining a normal terminating newline, then check the integrated diff. No runtime impact. Root removed only that final blank line in commit `49e424759fca69c155a428999703398ab2ebb1df` and corrected the task report. Reviewer inspected the exact follow-up diff (one blank-line deletion) and freshly ran `git diff --check 86eebb8abcafc8c4ad62c1d49ae731fb837f711e 49e424759fca69c155a428999703398ab2ebb1df`: exit 0, no output. No behavioral rerun was needed.

## Spec and implementation assessment

- `src/app.ts:129–130` creates a separate original-state snapshot and mutable candidate state. Narrative receives the original snapshot at line 162; neither the model input nor school validation loses the prior sleep window.
- The existing `prepareSchoolCommits` runs both through narrative contract validation and after narrative generation. Formal character state remains unchanged throughout those calls. Its unchanged readable predicate preserves `[sleepAt,wakeAt)`, publication/release bounds, actual activity permission, and experience range checks.
- `src/app.ts:173` clears only an ended sleep window before personal processing. The existing next-night `arrangeSleep` call remains in place. The shared path and its separate end-of-shared sleep handling are preserved.
- `src/model/prompts.ts:3` states the approved segmented time rule: valid presleep reading remains legal, sleep-interval reading is forbidden in ordinary non-shared turns, exact wakeAt is eligible independently of turn.at milliseconds, and release/publication/phone/experience constraints still apply.
- No school validator, recovery algorithm, protocol, configuration, dependency, or failure-handling code changed in this W1 diff.
- New tests cover original narrative sleep, personal cleared sleep, next-night schedule, 08:00:40 and in-sleep rejection, exact wakeAt and turn.at acceptance, legal presleep reading, publish/release bounds, denied phone access, a legal new readable activity, out-of-turn experiences, non-waking and shared controls.
- The B-transaction test injects a SQLite trigger failure after experience and school writes would have occurred; assertions verify rollback of character, experiences, school knowledge, and notice status. The retry then commits successfully.
- Disk recovery tests use the real ModelClient with fake transport and disabled WebSearchService. They exhaust the narrative checkpoint, close/reopen SQLite, advance the clock, retain business run identity and repairCount=2, and verify a legal first resumed response reaches personal/memory while an illegal response immediately pauses without personal execution.
- Attempted-output and sealed-silent disk cases prove no narrative regeneration and retain the original turn time, using memory-only resumed model execution. The underlying recovery and transaction paths were inspected alongside the tests.

## Evidence and limits

Read the full review diff, task brief/report, original plan W1 requirements, approved review R3/acceptance clarifications, and surrounding app, director, state/sleep, school validation, recovery, and fixture code.

Inspected existing logs: clean RED has 20 tests with 3 expected original-sleep-input failures; scoped GREEN has 6 files / 58 passing tests; typecheck log records `tsc --noEmit` without diagnostics. These are implementation evidence, not fresh reviewer executions. Per assignment, the green tests and typecheck were not duplicated because code review produced no new behavioral doubt. The whitespace command above was freshly executed against the exact reviewed commit and failed as described.

No source edits, commits, new tests, full-suite rerun, online requests, service actions, formal database/configuration access, or subagent dispatch occurred. Only this review artifact was written. Root retains ownership of merging W1 with M2 and final full-suite/build/demo/plugin validation.
