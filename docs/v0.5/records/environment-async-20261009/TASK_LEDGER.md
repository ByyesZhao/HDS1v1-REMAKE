# SDD ledger — plan: docs/v0.5/plans/environment-async/04_ENVIRONMENT_ASYNC.md

BASE=272437f
E1 started.
Ruling: legacy setup fixtures explicitly retain version1; new tests opt into version2 and persistent web sessions. Reason: distinguish compatibility from new behavior; cost: two intentional fixtures.

E1 complete 87b14f0:16 tests/typecheck.
E2 complete 8eaa396:39 tests/typecheck.
E3 complete 6a50a17:25 tests/typecheck.
E4 complete da47ea5:45 tests plus tools/phases.
E5 complete 2a6b981:145 files/801 tests, typecheck/build/demo/smoke,15 workload samples. Fresh review dispatched.
Final review: Important historical source body copied; Minor non-message source existence regraded Important under accepted source contract. One fix pass: three RED regressions, 4/30 GREEN, full146/804, type/build/demo/smoke and15 samples passed. Rulings and costs preserved in REVIEW_CLOSURE.md. No deferred minors. Main integration follows existing implementation authorization.
