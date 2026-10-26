# Changelog

## 0.1.0 (2026-10-26)

First release.

- CLI: `shush <command>`, pipe mode, `shush show`, `shush gain`
- MCP server (`shush mcp`) with `run`, `compress`, `read_full`, `gain`
- Rules: test runners (vitest/jest/mocha/pytest/go/cargo/TAP), installs (npm/pnpm/yarn/pip/cargo/go), git status/log/diff, generic ANSI/progress/repeat/length handling
- Full output saved for anything hidden; error lines are never filtered
- Token counts with the o200k_base tokenizer
