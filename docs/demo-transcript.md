# Demo transcript

Real output captured on 2026-10-26 with `node scripts/demo.mjs`, which starts `shush mcp` over stdio with the official MCP client SDK and calls the `run` tool on real projects (a TypeScript repo, a small Go module with a failing test, a Rust crate with a failing test, and a clone of sindresorhus/ky). Nothing is edited.

```text
> run "npx vitest run --reporter=verbose"  (cwd /workspace/turkiye-mcp)
 RUN  v4.1.12 /workspace/turkiye-mcp

 Test Files  5 passed | 1 skipped (6)
      Tests  69 passed | 6 skipped (75)
   Start at  14:00:34
   Duration  326ms (transform 401ms, setup 0ms, import 573ms, tests 83ms, environment 1ms)
[shush] exit 0 · 1,655 → 85 tokens (-95%) · hidden: 69 passing test lines, 6 skipped test lines · full output: shush show 20261026-140034-3242a4

> run "go test -v ./..."  (cwd /tmp/fx/gt)
    calc_test.go:26: Slug("Çay Saati") = "çay-saati", want "cay-saati"
--- FAIL: TestSlugTurkish (0.00s)
FAIL
FAIL	example.com/calc	0.002s
FAIL
[shush] exit 1 · 880 → 57 tokens (-94%) · hidden: 65 passing test lines · full output: shush show 20261026-140034-0d6e5b

> run "cargo test"  (cwd /tmp/fx/rs)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 5.49s
     Running unittests src/lib.rs (target/debug/deps/rs-d1ab299298e5c6b2)

running 4 tests
test tests::json_roundtrip ... FAILED

failures:

---- tests::json_roundtrip stdout ----

thread 'tests::json_roundtrip' panicked at src/lib.rs:7:106:
assertion `left == right` failed
  left: Number(1)
 right: 2
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace

failures:
    tests::json_roundtrip

test result: FAILED. 3 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

error: test failed, to rerun pass `--lib`
[shush] exit 101 · 419 → 194 tokens (-54%) · hidden: 16 progress lines, 3 passing test lines · full output: shush show 20261026-140040-fdaed8

> run "git log -6"  (cwd /tmp/fx/ky)
35418888 2026-10-09 Sindre Sorhus: 2.2.0
242c3272 2026-10-08 Sindre Sorhus: Let a `beforeRetry` hook change per-attempt options
d9ddb03b 2026-10-08 Sindre Sorhus: Fix CI
d93adf85 2026-10-08 Sindre Sorhus: Run the browser tests and static checks once in CI
a5ed57b1 2026-10-07 Sindre Sorhus: Refactor
7f0137dc 2026-09-29 Sindre Sorhus: Report the sent request for a hook's response, and finish the cross-realm and `null` checks
[shush] exit 0 · 445 → 158 tokens (-64%) · hidden: 2 commit message bodies · full output: shush show 20261026-140040-845279

```
