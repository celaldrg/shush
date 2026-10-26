import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clean, compress, IMPORTANT_RE, normalizeCommand, pickRule, stripAnsi } from "../src/compress.js";

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("cleaning", () => {
  it("strips ANSI colors and OSC hyperlinks", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m \x1b]8;;https://x.y\x07link\x1b]8;;\x07")).toBe("red link");
  });
  it("keeps only the final state of carriage-return progress bars", () => {
    expect(clean("downloading 10%\rdownloading 50%\rdownloading 100%\ndone")).toEqual(["downloading 100%", "done"]);
  });
  it("squeezes blank runs and trims edges", () => {
    expect(clean("\n\na\n\n\n\nb  \n\n")).toEqual(["a", "", "b"]);
  });
  it("normalizes runner prefixes", () => {
    expect(normalizeCommand("CI=1 NODE_ENV=test npx -y vitest run")).toBe("vitest run");
    expect(normalizeCommand("python -m pytest -q")).toBe("pytest -q");
  });
});

describe("rule selection", () => {
  it("by command", () => {
    expect(pickRule("git status", "")?.name).toBe("git-status");
    expect(pickRule("git log -20", "")?.name).toBe("git-log");
    expect(pickRule("git log --oneline", "")).toBeUndefined();
    expect(pickRule("git diff HEAD~1", "")?.name).toBe("git-diff");
    expect(pickRule("pnpm install", "")?.name).toBe("npm-install");
  });
  it("by sniffing piped output", () => {
    expect(pickRule(undefined, fx("git-log.txt"))?.name).toBe("git-log");
    expect(pickRule(undefined, fx("git-diff.txt"))?.name).toBe("git-diff");
    expect(pickRule(undefined, fx("pytest-fail.txt"))?.name).toBe("pytest");
  });
  it("does not trust the command for compound shell lines", () => {
    expect(pickRule("git log -1 && echo hi", "hi")).toBeUndefined();
  });
});

describe("never hides failures", () => {
  // Real outputs captured from failing runs. Every error-looking line must survive.
  const cases: [string, string][] = [
    ["vitest-fail.txt", "npx vitest run"],
    ["pytest-fail.txt", "pytest -v"],
    ["go-test-fail.txt", "go test -v ./..."],
    ["cargo-test-fail.txt", "cargo test"],
    ["tsc-errors.txt", "npx tsc --noEmit"],
  ];
  it.each(cases)("%s keeps every important line", (file, command) => {
    const raw = fx(file);
    const out = compress(raw, { command, exitCode: 1 }).text;
    for (const line of clean(raw)) {
      if (IMPORTANT_RE.test(line) && !/^\s*(Compiling|Downloaded)\s/.test(line)) expect(out).toContain(line);
    }
  });
});

describe("real outputs", () => {
  it("vitest verbose: hides passing tests, keeps the summary", () => {
    const r = compress(fx("vitest-verbose-pass.txt"), { command: "vitest run --reporter=verbose" });
    expect(r.hidden["passing test lines"]).toBe(69);
    expect(r.text).toContain("Tests  69 passed | 6 skipped (75)");
    expect(r.text).not.toMatch(/✓/);
  });
  it("go test -v: drops RUN/PASS noise, keeps the failing test", () => {
    const r = compress(fx("go-test-fail.txt"), { command: "go test -v ./..." });
    expect(r.text).toContain("--- FAIL: TestSlugTurkish");
    expect(r.text).toContain('want "cay-saati"');
    expect(r.text).not.toContain("=== RUN");
    expect(r.linesAfter).toBeLessThan(10);
  });
  it("cargo test: drops download/compile progress and passing tests", () => {
    const r = compress(fx("cargo-test-fail.txt"), { command: "cargo test" });
    expect(r.text).not.toMatch(/Compiling|Downloaded/);
    expect(r.text).toContain("test tests::json_roundtrip ... FAILED");
    expect(r.text).toContain("test result: FAILED. 3 passed; 1 failed");
  });
  it("npm install: folds deprecations into one line, keeps audit summary", () => {
    const r = compress(fx("npm-install.txt"), { command: "npm install" });
    expect(r.text.split("\n")[0]).toBe("npm warn deprecated (6): inflight@1.0.6, glob@7.2.3, har-validator@5.1.5, left-pad@1.3.0, uuid@3.4.0, request@2.88.2");
    expect(r.text).toContain("5 vulnerabilities (3 moderate, 2 critical)");
    expect(r.text).not.toContain("looking for funding");
  });
  it("npm ci --loglevel=verbose: removes the http/verbose chatter", () => {
    const r = compress(fx("npm-ci-verbose.txt"), { command: "npm ci --loglevel=verbose" });
    expect(r.text).not.toMatch(/^npm http /m);
    expect(r.text).toContain("added 142 packages");
    expect(r.linesAfter).toBeLessThan(20);
  });
  it("pip install: removes Collecting/Downloading", () => {
    const r = compress(fx("pip-install.txt"), { command: "pip install requests rich" });
    expect(r.text).not.toMatch(/^(Collecting|\s+Downloading)/m);
    expect(r.text).toMatch(/^Successfully installed /m);
  });
  it("git status: one line per section", () => {
    const r = compress(fx("git-status.txt"), { command: "git status" });
    expect(r.text).toBe([
      "On branch main",
      "Your branch is up to date with 'origin/main'.",
      "staged (1): D readme.md",
      "unstaged (2): D license, M source/core/Ky.ts",
      "untracked (3): ?? NEWFILE.md, ?? readme.md, ?? tmpdir/",
    ].join("\n"));
  });
  it("git log: one line per commit", () => {
    const r = compress(fx("git-log.txt"), { command: "git log" });
    const lines = r.text.split("\n");
    expect(lines).toHaveLength(60);
    expect(lines[0]).toMatch(/^[0-9a-f]{8} \d{4}-\d{2}-\d{2} .+: .+/);
  });
  it("git log: passes through unrelated trailing output", () => {
    const raw = "commit " + "a".repeat(40) + "\nAuthor: A <a@b.c>\nDate:   Mon Oct 26 10:00:00 2026 +0000\n\n    Subject line\n\nOn branch main\n";
    const r = compress(raw, { command: "git log" });
    expect(r.text).toBe("aaaaaaaa 2026-10-26 A: Subject line\nOn branch main");
  });
  it("git diff: keeps every changed line, collapses deleted files and long context", () => {
    const raw = fx("git-diff.txt");
    const r = compress(raw, { command: "git diff" });
    expect(r.text).toContain("(file deleted: 9 lines removed)");
    const blocks = raw.split(/^(?=diff --git )/m).filter((b) => !/^deleted file mode /m.test(b));
    const changed = blocks.flatMap((b) => b.split("\n").filter((l) => /^[+-](?![+-]{2} )/.test(l)));
    expect(changed.length).toBeGreaterThan(20);
    for (const l of changed) expect(r.text).toContain(l.replace(/\s+$/, ""));
  });
});

describe("generic behaviour", () => {
  it("collapses runs of similar lines", () => {
    const raw = Array.from({ length: 50 }, (_, i) => `building module ${i} of 50`).join("\n") + "\nbuild complete";
    const r = compress(raw);
    expect(r.text).toBe("building module 0 of 50\nbuilding module 1 of 50\n  … (+48 similar lines)\nbuild complete");
  });
  it("caps length but keeps error lines from the middle", () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i} ${"x".repeat(i % 7)}${i % 2 ? "a" : "b"}`);
    lines[500] = "Error: something broke at step 500";
    const r = compress(lines.join("\n"), { maxLines: 100 });
    expect(r.text).toContain("Error: something broke at step 500");
    expect(r.linesAfter).toBeLessThanOrEqual(110);
    expect(r.hidden["omitted for length"]).toBeGreaterThan(0);
  });
  it("leaves short, clean output alone", () => {
    const r = compress("hello\nworld");
    expect(r).toMatchObject({ text: "hello\nworld", lossy: false });
  });
});
