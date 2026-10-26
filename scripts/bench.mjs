// Benchmark: compress every captured real output in tests/fixtures and print a markdown table.
//   npm run build && node scripts/bench.mjs
import { readFileSync } from "node:fs";
import { compress } from "../dist/compress.js";
import { countTokens } from "../dist/tokens.js";

const cases = [
  ["git status", "git-status.txt", "git status"],
  ["git log (60 commits)", "git-log.txt", "git log"],
  ["git diff", "git-diff.txt", "git diff"],
  ["vitest, verbose, all passing", "vitest-verbose-pass.txt", "vitest run --reporter=verbose"],
  ["vitest, 3 failures", "vitest-fail.txt", "vitest run"],
  ["pytest -v, 2 failures", "pytest-fail.txt", "pytest -v"],
  ["go test -v, 1 failure", "go-test-fail.txt", "go test -v ./..."],
  ["cargo test (fresh build), 1 failure", "cargo-test-fail.txt", "cargo test"],
  ["npm install (deprecated deps)", "npm-install.txt", "npm install"],
  ["npm ci --loglevel=verbose", "npm-ci-verbose.txt", "npm ci --loglevel=verbose"],
  ["pip install requests rich", "pip-install.txt", "pip install requests rich"],
  ["tsc, 5 errors", "tsc-errors.txt", "tsc --noEmit"],
];

let tb = 0, ta = 0;
console.log("| Output | Before | After | Saved |");
console.log("|---|--:|--:|--:|");
for (const [label, file, command] of cases) {
  const raw = readFileSync(new URL(`../tests/fixtures/${file}`, import.meta.url), "utf8");
  const out = compress(raw, { command });
  const b = countTokens(raw), a = Math.min(b, countTokens(out.text));
  tb += b; ta += a;
  console.log(`| ${label} | ${b.toLocaleString("en-US")} | ${a.toLocaleString("en-US")} | ${Math.round(((b - a) / b) * 100)}% |`);
}
console.log(`| **Total** | **${tb.toLocaleString("en-US")}** | **${ta.toLocaleString("en-US")}** | **${Math.round(((tb - ta) / tb) * 100)}%** |`);
