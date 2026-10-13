# Task 3 / W1 report

Status: IMPLEMENTED; ready for independent root review and integration. No commits created.

Worktree: C:/Users/<user>/.codex/worktrees/waking-time-boundary/HDSI-remake
Branch: codex/waking-time-boundary-20261013
Base: 86eebb8abcafc8c4ad62c1d49ae731fb837f711e (approved M1)

## Exact changed files

- src/app.ts: snapshot stateBefore separately from mutable candidate state; give narrative the original sleep facts; clear only an ended sleep interval after narrative and school validation, before personal input. The original story B transaction remains the only character-state commit. Existing next-night arrangeSleep behavior remains intact.
- src/model/prompts.ts: describe waking as the turn endpoint reaching wakeAt, forbid ordinary reading inside [sleepAt,wakeAt), require the turn interval, publication/release times and actual phone permissions, preserve valid presleep reading and allow wakeAt independently of turn.at milliseconds.
- tests/waking-school-notice.test.ts: 20 synthetic tests covering original narrative sleep, personal cleared sleep, next-night scheduling, read permission boundaries, valid presleep reading, publication/release, phone restrictions and new activity, experience range, non-waking and shared controls, B rollback/commit, reopened disk narrative repair exhaustion, and attempted/silent sealed candidate preservation.
- .superpowers/sdd/README/task-3-report.md: this report (workflow evidence, not a product file).

src/school/progress.ts does not need a change: canRead already uses the half-open sleep interval and accepts 08:01:00.000 when turn.at is 08:01:00.008. Preserving narrative input fixes the mismatch without widening the permission validator or introducing a blanket wakeAt lower bound.

## RED / GREEN evidence

Every command used the worktree above as an absolute working directory and exec_command sandbox_permissions=require_escalated. TEMP and TMP were set to C:/Users/<user>/.codex/worktrees/waking-time-boundary/HDSI-remake/.tmp/memory-retry-waking-20261013. All databases/transports/senders were synthetic; web service was disabled.

RED, before product edits:

    npm test -- tests/waking-school-notice.test.ts

Exit 1: 20 tests, 3 expected failures, 17 pass. Failures:

- waking_narrative_receives_original_sleep_window
- failed_waking_turn_reopens_at_new_clock_with_repair_budget_two (invalid=false)
- failed_waking_turn_reopens_at_new_clock_with_repair_budget_two (invalid=true)

All three receive narrative state.sleep=null instead of the literal original 00:06–08:01 window. Permission and recovery-budget controls already pass. An earlier test-draft run exposed missing chat bindings in three manually-created fixtures; corrected those fixtures before the clean RED above. No product edits preceded clean RED.
Log: .tmp/memory-retry-waking-20261013/task-3-red.log

Initial GREEN:

    npm test -- tests/waking-school-notice.test.ts

Exit 0: 1 file, 20 tests passed.
Log: .tmp/memory-retry-waking-20261013/task-3-green-initial.log

Required scoped GREEN:

    npm test -- tests/waking-school-notice.test.ts tests/world-school-review14-time.test.ts tests/world-school-personal-reminder.test.ts tests/personal-task-contract-recovery.test.ts tests/recovery.test.ts tests/phone-access-flow.test.ts

Exit 0: 6 files, 58 tests passed. Duration 10.29 seconds.
Log: .tmp/memory-retry-waking-20261013/task-3-green.log

    npm run typecheck

Exit 0, tsc --noEmit passed.
Log: .tmp/memory-retry-waking-20261013/task-3-typecheck.log

    git diff --check

Exit 0. Final self-review removed incidental added trailing blank lines and an unused type import only.

## Self-review

- Narrative receives the same unmodified sleep facts used by existing school validation; candidate state mutations cannot change that snapshot.
- Sleep is removed only after successful narrative validation and only if wakeAt is due. Personal receives sleep=null on an ended waking window. The literal next-night plan is asserted (next sleep at 2026-10-07T16:00:00.000Z, next wake at 2026-10-08T00:30:00.000Z for the fixed random fixture).
- Permissions retain the original validator: 23:50 presleep reading passes when already published/released, 00:30 and 08:00:40 sleep readings reject, exact wakeAt passes. Actual phoneAccess=false, unavailable publication/release and out-of-turn experiences reject; legal new phone-readable activity and valid shared behavior remain allowed.
- Injected B-transaction failure leaves formal character, experiences, school knowledge and notice-read status unchanged; successful retry commits all together and retains next-night sleep.
- Disk tests exhaust the real ModelClient narrative checkpoint through three illegal responses (repairCount=2), close/reopen SQLite, advance the clock ten minutes, and retain turn ID plus narrative run ID. Legal first response continues to personal and memory. Illegal first response fails immediately with ModelFormatError, leaves repairCount=2, pauses generation, saves no output/experiences/knowledge, and never invokes personal.
- Disk attempted sending and silent outputComplete candidates keep their original turn time and narrative; resume invokes only memory and finishes the original candidate.
- M2 failure-handling code is untouched. No protocol, dependencies, config, production DB, real QQ, online model/search, or service actions changed.

## Outstanding concerns / root handoff

No identified product defects remain in this task. Root must independently review and integrate the app.ts generation hunk with the separately-owned M2 failure-handling hunk, then run the final full suite/build/demo/plugin acceptance. No bare full suite was run by this task, per the task ownership instruction. No tests remain outstanding, and no edits occurred while a test process was outstanding.
Root review follow-up: independent full-commit-range whitespace check found one trailing blank line missed by the unstaged-only check; root removed it as formatting only, committed separately, and git diff --check 86eebb8 HEAD now exits 0. No behavioral code change or test rerun.
