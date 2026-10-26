# shush 🤫

**Cut the noise from command output before it reaches your AI agent.** Passing tests, progress bars, download logs, git chatter and repeated lines go; every error, failure and summary stays. Anything hidden is one call away.

Works with **any agent**: as an MCP server (Claude Code, Cursor, VS Code, Codex, Gemini CLI, Kiro, Junie, Zed…) or as a plain CLI prefix (`shush npm test`). MIT, no daemon, no proxy, no model download, no API keys.

[![CI](https://github.com/celaldrg/shush/actions/workflows/ci.yml/badge.svg)](https://github.com/celaldrg/shush/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node >= 20](https://img.shields.io/badge/node-%3E%3D20-339933)

```text
$ shush go test -v ./...
    calc_test.go:26: Slug("Çay Saati") = "çay-saati", want "cay-saati"
--- FAIL: TestSlugTurkish (0.00s)
FAIL
FAIL	example.com/calc	0.002s
FAIL
[shush] exit 1 · 880 → 57 tokens (-94%) · hidden: 65 passing test lines · full output: shush show 20261026-140034-0d6e5b
```

## Why

Agents read every line a command prints. A green `vitest --reporter=verbose` run is 1,655 tokens of check marks; a verbose `npm ci` is 5,670 tokens of HTTP cache hits. That burns context, money and attention, and the one line that matters gets buried.

Tools like [rtk](https://github.com/rtk-ai/rtk) and [headroom](https://github.com/headroomlabs-ai/headroom) proved how much this matters. shush is a smaller, stricter take on the same idea, built around three promises:

1. **Never hide a failure.** Lines that look like errors, failures, panics, assertions or warnings are protected from every filter. A test suite checks this against real failing outputs from vitest, pytest, go test, cargo test and tsc.
2. **Never a dead end.** When anything is hidden, the footer says exactly what (`hidden: 65 passing test lines`) and the raw output is saved. Agents call `read_full` (with paging and grep) or you run `shush show <id>`.
3. **Never touch your command.** shush runs exactly what you typed and only filters what comes back. It does not rewrite `npm run lint` into something else.

## Benchmarks

Real outputs captured from real tools (in [`tests/fixtures`](tests/fixtures)), counted with the `o200k_base` tokenizer (not bytes / 4). Reproduce with `npm run build && npm run bench`.

| Output | Before | After | Saved |
|---|--:|--:|--:|
| git status | 137 | 59 | 57% |
| git log (60 commits) | 4,611 | 1,730 | 62% |
| git diff | 3,270 | 2,215 | 32% |
| vitest, verbose, all passing | 1,655 | 85 | 95% |
| vitest, 3 failures | 1,010 | 1,009 | 0% |
| pytest -v, 2 failures | 1,228 | 428 | 65% |
| go test -v, 1 failure | 880 | 57 | 94% |
| cargo test (fresh build), 1 failure | 631 | 194 | 69% |
| npm install (deprecated deps) | 306 | 104 | 66% |
| npm ci --loglevel=verbose | 5,670 | 76 | 99% |
| pip install requests rich | 749 | 106 | 86% |
| tsc, 5 errors | 152 | 152 | 0% |
| **Total** | **20,299** | **6,215** | **69%** |

The two 0% rows are on purpose: a failing vitest run and a list of tsc errors are already almost all signal, so shush leaves them alone.

## Install

Requires Node.js 20+. Not on npm yet, so `npx` installs from GitHub (`github:celaldrg/shush`). Once it is published this becomes `npx -y shush-mcp`.

### As an MCP server (recommended for agents)

The server exposes four tools: `run` (run a command, get compact output), `compress` (compress text you already have), `read_full` (page/grep the full output) and `gain` (savings so far).

**Claude Code**

```bash
claude mcp add shush -- npx -y github:celaldrg/shush mcp
```

**Cursor** (`~/.cursor/mcp.json`), **Claude Desktop** (`claude_desktop_config.json`), **Kiro** (`.kiro/settings/mcp.json`), **Gemini CLI** (`~/.gemini/settings.json`) and most other clients:

```json
{
  "mcpServers": {
    "shush": { "command": "npx", "args": ["-y", "github:celaldrg/shush", "mcp"] }
  }
}
```

**VS Code**

```bash
code --add-mcp '{"name":"shush","command":"npx","args":["-y","github:celaldrg/shush","mcp"]}'
```

**Codex CLI** (`~/.codex/config.toml`)

```toml
[mcp_servers.shush]
command = "npx"
args = ["-y", "github:celaldrg/shush", "mcp"]
```

Then tell the agent to use it. Add this to `AGENTS.md` / `CLAUDE.md`:

```markdown
For commands with long output (tests, builds, installs, linters, git log/diff/status),
use the shush `run` tool instead of the shell. If the footer says something was hidden
and you need it, call `read_full` with the id it prints.
```

### As a CLI (any agent, any shell, CI logs)

```bash
npm install -g github:celaldrg/shush   # or use npx -y github:celaldrg/shush ...

shush npm test                         # run, compact output, same exit code
shush "npm ci && npm run build"        # one quoted argument runs through your shell
some-command 2>&1 | shush --cmd "pytest -v"   # compress piped output
shush show 20261026-140034-0d6e5b --grep TestSlug   # read what was hidden
shush gain                             # tokens saved on this machine
```

An agent that only has a shell can use shush too: tell it to prefix noisy commands with `shush`.

## What it does

| Output | What shush does |
|---|---|
| Test runners (vitest, jest, mocha, pytest, go test, cargo test, TAP) | Hides passing and skipped test lines; keeps failures, stack traces, diffs and the summary |
| Installs (npm, pnpm, yarn, pip, cargo, go) | Hides download/compile progress, HTTP cache logs and funding notices; folds deprecation warnings into one line; keeps errors and the audit summary |
| `git status` | One line per section: `unstaged (2): D license, M src/a.ts` |
| `git log` | One line per commit: hash, date, author, subject (bodies are counted in the footer) |
| `git diff` / `git show` | Every `+`/`-` line kept; `index` and `---/+++` headers dropped; unchanged context trimmed to 1 line; deleted files summarized |
| Everything else | Strips ANSI colors, resolves `\r` progress bars, collapses runs of near-identical lines (`… (+48 similar lines)`), caps very long output at head + tail + every error line in between |

Exit codes are always preserved and printed. If compression would not save anything, the output passes through unchanged.

## shush vs rtk vs headroom

Credit where due: shush is **inspired by [rtk](https://github.com/rtk-ai/rtk)** (Apache-2.0; its full edition ships a BUSL-1.1 engine) and **[headroom](https://github.com/headroomlabs-ai/headroom)** (Apache-2.0). It is an original implementation; no code was copied. Pick the one that fits:

| | shush | rtk | headroom |
|---|---|---|---|
| How it reaches the agent | MCP tool or CLI prefix | Per-agent hooks that rewrite shell commands | Proxy, `wrap` per agent, library, MCP |
| New agent support | Anything that speaks MCP or runs a shell | Needs a hook per agent ([#845](https://github.com/rtk-ai/rtk/issues/845), [#1589](https://github.com/rtk-ai/rtk/issues/1589), [#2136](https://github.com/rtk-ai/rtk/issues/2136), [#2898](https://github.com/rtk-ai/rtk/issues/2898)) | Needs a wrapper per agent ([#1165](https://github.com/headroomlabs-ai/headroom/issues/1165), [#777](https://github.com/headroomlabs-ai/headroom/issues/777), [#975](https://github.com/headroomlabs-ai/headroom/issues/975)) |
| Rewrites your command | Never | Yes, transparently (e.g. [#1489](https://github.com/rtk-ai/rtk/issues/1489)) | No (works on content) |
| Automatic for every command | No: the agent must choose `run` or `shush` | Yes, for Bash tool calls | Yes, when wrapped/proxied |
| Getting the hidden part back | `read_full` with paging + grep, `shush show` | See rtk docs | `headroom_retrieve` (CCR) |
| Token counts reported | Real tokenizer (o200k) | `bytes / 4` estimate (per its README) | Provider tokenizer in its benchmarks |
| Install | `npx`, Node 20+, ~800 lines of TS | Single Rust binary (brew/winget/curl) | Python package + optional ML model |
| Breadth | ~12 output families (v0.1) | 100+ commands | Logs, JSON, code, prose, chat history |
| License | MIT | Apache-2.0 (+ BUSL-1.1 engine in full edition) | Apache-2.0 |

If you want maximum coverage and automatic interception in a supported agent, use rtk or headroom. If you want something small, MIT, auditable in one sitting, that works the same in every MCP client and never changes what you ran, use shush.

## Demo

Real transcript of an MCP client calling `run` on real projects: [docs/demo-transcript.md](docs/demo-transcript.md). Excerpt:

```text
> run "npx vitest run --reporter=verbose"  (cwd /workspace/turkiye-mcp)
 RUN  v4.1.12 /workspace/turkiye-mcp

 Test Files  5 passed | 1 skipped (6)
      Tests  69 passed | 6 skipped (75)
   Start at  14:00:34
   Duration  326ms (transform 401ms, setup 0ms, import 573ms, tests 83ms, environment 1ms)
[shush] exit 0 · 1,655 → 85 tokens (-95%) · hidden: 69 passing test lines, 6 skipped test lines · full output: shush show 20261026-140034-3242a4

> run "git log -6"  (cwd /tmp/fx/ky)
35418888 2026-10-09 Sindre Sorhus: 2.2.0
242c3272 2026-10-08 Sindre Sorhus: Let a `beforeRetry` hook change per-attempt options
d9ddb03b 2026-10-08 Sindre Sorhus: Fix CI
d93adf85 2026-10-08 Sindre Sorhus: Run the browser tests and static checks once in CI
a5ed57b1 2026-10-07 Sindre Sorhus: Refactor
7f0137dc 2026-09-29 Sindre Sorhus: Report the sent request for a hook's response, and finish the cross-realm and `null` checks
[shush] exit 0 · 445 → 158 tokens (-64%) · hidden: 2 commit message bodies · full output: shush show 20261026-140040-845279
```

## Privacy and safety

- Everything runs locally. Nothing is sent anywhere.
- Full outputs are saved to `<tmp>/shush` (mode 0600, newest 200 kept); change with `SHUSH_LOG_DIR`. They can contain whatever your commands print, secrets included, so treat that folder like your terminal scrollback.
- A local ledger of token counts (no output content) goes to `~/.shush/stats.jsonl`; disable with `SHUSH_NO_STATS=1`.
- The MCP `run` tool executes shell commands, exactly like your agent's own shell tool. It is annotated as destructive, so clients that honor MCP tool annotations ask before running it.

## Limitations (v0.1)

- Not automatic: agents use it when told to (see the `AGENTS.md` snippet).
- Fewer specialized rules than rtk. Unknown tools still get the generic filters.
- Tested on Linux and macOS. Windows should work (commands run through `cmd.exe`) but is not in CI yet.
- `git log` keeps only the subject line. Use `--format` or `--oneline` yourself if you need more; shush leaves explicitly formatted output alone.

## Development

```bash
npm install          # also builds
npm test             # unit tests on real captured outputs + CLI + MCP over stdio
npm run bench        # the table above
node scripts/demo.mjs '[{"command":"git log -5"}]'
```

New rules are welcome. Please add a real captured output to `tests/fixtures` with every rule.

## License

[MIT](LICENSE) © Celalettin Durğaç
