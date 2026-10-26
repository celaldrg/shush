import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

/** Where full raw outputs are kept (so compression is never a dead end). */
export function logDir(): string {
  return process.env.SHUSH_LOG_DIR ?? join(tmpdir(), "shush");
}

/** Where the savings ledger lives. */
export function homeDir(): string {
  return process.env.SHUSH_HOME ?? join(homedir(), ".shush");
}

const ID_RE = /^\d{8}-\d{6}-[0-9a-f]{6}$/;
const KEEP_LOGS = 200;

/** Save raw output and return its id, e.g. "20261026-141503-a1b2c3". */
export function saveFull(raw: string, command?: string): string {
  const dir = logDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const id = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${randomBytes(3).toString("hex")}`;
  const header = command ? `$ ${command}\n` : "";
  writeFileSync(join(dir, `${id}.log`), header + raw, { mode: 0o600 });
  prune(dir);
  return id;
}

function prune(dir: string): void {
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".log")).sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_LOGS))) unlinkSync(join(dir, f));
  } catch {
    /* best effort */
  }
}

export function fullPath(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`Invalid output id "${id}".`);
  return join(logDir(), `${id}.log`);
}

export function readFull(id: string): string {
  const p = fullPath(id);
  if (!existsSync(p)) throw new Error(`No saved output with id ${id} (logs are kept in ${logDir()}, newest ${KEEP_LOGS}).`);
  return readFileSync(p, "utf8");
}

export interface PageOptions { start?: number; lines?: number; grep?: string }

/** Return a window of a saved output, optionally filtered by a regex. Lines are 1-based. */
export function pageFull(id: string, opts: PageOptions = {}): { total: number; start: number; end: number; text: string } {
  const all = readFull(id).split("\n");
  let rows = all.map((l, i) => ({ n: i + 1, l }));
  if (opts.grep) {
    const re = new RegExp(opts.grep, "i");
    rows = rows.filter((r) => re.test(r.l));
  }
  const start = Math.max(1, opts.start ?? 1);
  const count = Math.min(Math.max(1, opts.lines ?? 200), 2000);
  const slice = rows.slice(start - 1, start - 1 + count);
  return {
    total: rows.length,
    start,
    end: start - 1 + slice.length,
    text: slice.map((r) => `${String(r.n).padStart(5)}  ${r.l}`).join("\n"),
  };
}

export interface LedgerEntry { ts: string; command: string; rule: string; before: number; after: number }

export function record(entry: LedgerEntry): void {
  if (process.env.SHUSH_NO_STATS === "1") return;
  try {
    const dir = homeDir();
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "stats.jsonl"), JSON.stringify(entry) + "\n");
  } catch {
    /* stats are optional */
  }
}

export function readLedger(): LedgerEntry[] {
  const f = join(homeDir(), "stats.jsonl");
  if (!existsSync(f) || statSync(f).size === 0) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l) as LedgerEntry]; } catch { return []; }
  });
}

export function summarizeLedger(entries: LedgerEntry[]) {
  const before = entries.reduce((a, e) => a + e.before, 0);
  const after = entries.reduce((a, e) => a + e.after, 0);
  const byCmd = new Map<string, { runs: number; before: number; after: number }>();
  for (const e of entries) {
    const key = e.command.split(/\s+/).slice(0, 2).join(" ") || "(stdin)";
    const v = byCmd.get(key) ?? { runs: 0, before: 0, after: 0 };
    v.runs++; v.before += e.before; v.after += e.after;
    byCmd.set(key, v);
  }
  const top = [...byCmd.entries()].sort((a, b) => (b[1].before - b[1].after) - (a[1].before - a[1].after)).slice(0, 10);
  return { runs: entries.length, before, after, saved: before - after, pct: before ? Math.round(((before - after) / before) * 100) : 0, top };
}
