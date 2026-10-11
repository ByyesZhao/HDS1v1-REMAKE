# M1-B independent review

Verdict: **PASS**

Reviewed the exact M1-B brief and implementation report against baseline `a8fb72d`, restricting implementation review to the report's seven paths. No actionable correctness or scope findings.

- `src/memory/capacity.ts`: metadata-mode protection/counts and owner-mode short pairing/order retain the specified historical identity boundary. The no-overflow and zero-budget branches avoid owner/history reads. Exits hydrate full owners, preserve existing dirty/grant paths, and immediately replace snapshot entries. Temporary protections remain separate from `protectedLong`. Budget checks remain between exit units, allowing the short/preview pair to complete together; the unlimited story path still handles multiple pairs.
- `src/memory/policy-order.ts`: ID deduplication and 500-parameter batches select only canonical ID/time, maximum awakening time uses parsed epochs, keys preserve the short's own event timestamp and canonical awakening count, and both comparators use only precomputed values with the existing ID comparison.
- `src/deployment/memory-capacity-upgrade.ts`: inspection remains read-only, reuses one policy snapshot, uses metadata canonical resolution and skips awakening reads when that table is absent. Existing archive SQL and upgrade behavior are preserved.
- Regression coverage includes no-change work counts at both payload sizes; bounded single-overflow reads; blank/missing summaries; normal/temporary protections; shared preview snapshot mutation; atomic budget one and unlimited recovery integration; all ordering tiers, ISO offsets and canonical collisions; read-only legacy inspection.

Independent verification: ran the six required M1-B suites together with the five disjoint M2-A suites using workspace-local `TEMP`/`TMP` and `--maxWorkers=1 --no-isolate`. **11 files / 92 tests passed**, exit 0. M1-B's six-file subset accounts for 54 tests as reported. No full suite, formal database, network, timing benchmark, production edits or Git mutations were performed. Typecheck was not repeated during concurrent M2-B edits.

Limits: the work counters establish removed hydration/comparator reads; they do not establish constant latency or independence from SQLite payload-page size.
