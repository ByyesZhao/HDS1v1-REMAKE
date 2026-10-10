# Independent review — graceful stop (2026-10-10)

## Scope and evidence

Fresh-context review of `4d18f84..5703630` (`570363003699038bb312a2e956a093f9f99e1287`) in `C:/Users/<user>/.codex/worktrees/graceful-stop/HDSI-remake`. Read this record's README.md and DELIVERY.md, the complete product diff, new stop tests, surrounding host/input/foreground flow, environment preparation, memory maintenance, incoming-media resources, both plugin assembly paths, managed browser lifecycle, and installed Koishi CLI/worker exit handling. Product code, formal configuration, formal database, and formal services were not changed by this reviewer.

Approval interpreted as: local stop closes input admission and dispatch; current foreground runTurn completes through sending and extraction; current environment/school and maintenance preparations may publish persisted ready results; downloads already running drain; silent timers, appointments, unopened next stages, and subsequent maintenance batches are not awaited. Default plugin disposal/service removal retains cancellation. Existing request timeouts and stale-result validity rules remain applicable.

Actual independent execution (offline, isolated checkout, elevated only for authorized test subprocess/filesystem access):

- `node node_modules/vitest/vitest.mjs run tests/graceful-stop-host.test.ts tests/graceful-stop-control.test.ts tests/graceful-stop-process.test.ts tests/browser-web-plugin.test.ts tests/browser-web-plugin-extra.test.ts tests/incoming-media-assets.test.ts`: **6 files / 18 tests passed**, exit 0, 3.25 seconds, 2026-10-10 17:52 local time. This includes real child-process storage reopen assertions and Context browser disposal/exit tests.
- Additional synthetic child launched the existing `tests/fixtures/graceful-stop-worker.ts` via `node --import tsx`, with a fresh temporary SQLite database and only loopback HTTP. A valid stop POST was sent and its client socket destroyed 20 ms later, before the fixture's 100 ms world completion. After 500 ms, result.json contained `{ "status": "ready", "aborted": false, "attempted": 1 }`, but `child.exitCode` was null and control.json still existed. The reviewer terminated only this synthetic child and removed its temporary directory.

Executor-reported typecheck/build/full-suite status is not independent execution evidence. Full suite was still running during this review; this report makes no full-suite claim.

## Strengths

- Host dispatch rechecks stopped after asynchronous selection, and rejects later wake/input calls; the foreground promise remains awaited without injecting cancellation into later phases of the same turn.
- Environment and maintenance separate dispatch draining from stopped publication eligibility, so active preparations can persist ready results while refusing a next stage/batch. The original abort behavior remains the default.
- Plugin runtime closes host before media, browser, and SQLite, and shares a single close promise. Browser service-removal cancellation remains distinct from graceful exit and replacement stays serialized.
- The local entry binds loopback, requires a random token, shares one drain for concurrent authenticated stop requests, and returns failure without force-killing when shutdown rejects. Koishi CLI source exits naturally when its worker returns 0.

## Critical

None found in the reviewed range.

## Important

### I1 — A disconnected stopping client prevents worker exit after successful saving

**Location:** `src/deployment/stop-control.ts:18` (success response finish handler).

Successful shutdown starts control cleanup/process exit only from `res.once('finish', ...)`. If the stop window/client disappears while the current work is running, that response is already destroyed when drain completes, and finish is never emitted. The real synthetic child still completed world preparation, persisted ready, and closed storage, but left the worker and stop endpoint running. CLI consequently cannot exit naturally. A later second authenticated stop request can rescue the state, but the accepted original stop request does not complete the required process lifecycle by itself.

**Required correction:** Tie the single successful-drain cleanup/exit lifecycle to drain completion, independent of a particular client's response finish; allow still-connected callers to receive their success responses. Add a real disconnected-client regression that confirms persisted ready data and child/CLI exit without requiring another stop request. The coordinator has acknowledged this finding and is implementing the fix separately; that future change is outside this report's reviewed SHA.

## Minor

None. The missing disconnect regression is included in I1 rather than counted twice.

## Declined

- Real supplier/model, QQ delivery, actual browser navigation, and formal runtime startup: prohibited by task authorization; tested synthetic work and inspected lifecycle contracts instead.
- Windows manual double-click UX, console-parent Ctrl+C semantics, abrupt window closure of the HDSI console itself, power loss, and task-manager termination: outside this local-stop review; README explicitly does not guarantee those paths. Closing the stop client alone remains within the endpoint reliability finding above.
- A remote task that never settles despite an existing normal timeout, or filesystem/device failure during saving: existing dependency/error contracts; this change intentionally adds no shutdown deadline and promises no successful model result.
- Reinterpretation of current stale-generation/business-basis checks or forcing ready results to commit while input/unfinished-turn eligibility forbids it: outside the approved limited design; ready persistence and normal restart validation were reviewed.
- Application-wide teardown guarantees for unrelated Koishi plugins/multiple HDSI instances sharing one baseDir: outside the single-instance HDSI deployment requirements; no broader lifecycle contract inferred.
- Full-suite, typecheck, and build results: not independently executed by this reviewer; use executor logs for those claims.

## Assessment

**Ready to integrate this reviewed range: with fixes; I1 must be addressed first.**

The normal connected-client path has direct passing offline evidence, including persisted ready data and child exit. The independent disconnect reproduction proves an endpoint lifecycle gap that breaks reliable worker/CLI exit after saving. No additional Critical or Important findings emerged from the host, background publication, repeated request, browser/non-browser assembly, or default cancellation review. This verdict covers only the specified SHA range; it does not certify a later fix or real production behavior.
