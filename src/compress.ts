/**
 * The compression engine. Pure functions, no I/O.
 *
 * Pipeline: clean (ANSI, carriage returns, blank runs) -> command-specific rule ->
 * generic noise filter -> collapse runs of similar lines -> length cap that always keeps
 * error-looking lines. Every hidden line is counted and reported, never silently dropped.
 */

export interface CompressOptions {
  /** The command that produced the output, e.g. "npm test". Used to pick a rule. */
  command?: string;
  /** Exit code of the command, if known. */
  exitCode?: number | null;
  /** Hard cap on output lines after compression (default 150). */
  maxLines?: number;
}

export interface CompressResult {
  text: string;
  /** Name of the command-specific rule that was applied ("generic" if none). */
  rule: string;
  linesBefore: number;
  linesAfter: number;
  /** Counts of hidden lines by reason. */
  hidden: Record<string, number>;
  /** True if anything was removed (so the caller should keep the full output). */
  lossy: boolean;
}

interface RuleOutput {
  lines: string[];
  /** Run the generic noise filter and similar-line collapse afterwards (default true). */
  generic?: boolean;
  /** Override the default line cap for this rule. */
  maxLines?: number;
}

interface Rule {
  name: string;
  /** Matches the normalized command line. */
  command?: RegExp;
  /** Sniffs the output when no command is known (pipe mode). */
  sniff?: (text: string) => boolean;
  apply: (lines: string[], hide: Hide) => RuleOutput;
}

type Hide = (reason: string, n?: number) => void;

// ---------------------------------------------------------------- cleaning

// CSI sequences, OSC sequences (hyperlinks, titles) and lone ESC codes.
const ANSI_RE = /\x1b\[[0-9;?]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

/** Strip ANSI codes, resolve carriage-return progress bars, trim trailing spaces, squeeze blank runs. */
export function clean(raw: string): string[] {
  const text = stripAnsi(raw).replace(/\r\n/g, "\n");
  const out: string[] = [];
  let blank = 0;
  for (let line of text.split("\n")) {
    if (line.includes("\r")) {
      // A progress bar redraws itself with \r; only the final state matters.
      const parts = line.split("\r").filter((p) => p.trim() !== "");
      line = parts.length ? parts[parts.length - 1] : "";
    }
    line = line.replace(/[ \t]+$/, "");
    if (line === "") {
      blank++;
      if (blank > 1) continue;
    } else blank = 0;
    out.push(line);
  }
  while (out.length && out[0] === "") out.shift();
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

/** Strip env assignments and runner prefixes so "CI=1 npx vitest run" is seen as "vitest run". */
export function normalizeCommand(cmd: string): string {
  let c = cmd.trim().replace(/^(\w+=("[^"]*"|'[^']*'|\S*)\s+)+/, "");
  c = c.replace(/^(npx|pnpx|bunx|uvx|(pnpm|yarn|bun)\s+(exec|dlx)|python3?\s+-m|poetry\s+run|uv\s+run)\s+(-y\s+)?/, "");
  return c;
}

// ---------------------------------------------------------------- generic filters

/** Lines that must never be hidden. */
export const IMPORTANT_RE =
  /\b(error|errors|err!|fail|failed|failure|failures|failing|panic|panicked|exception|traceback|fatal|warn|warning|assert|assertion|expected|received|denied|refused|not found|no such|cannot|can't|undefined|unresolved|segmentation|abort|aborted|timeout|timed out|conflict|vulnerabilit(y|ies)|critical)\b|✗|×|❌|✘|^E\s|^>\s/i;

const NOISE: { reason: string; re: RegExp; force?: boolean }[] = [
  // passing tests
  { reason: "passing test lines", re: /^\s*(✓|✔|√)\s/ },
  { reason: "passing test lines", re: /\sPASSED(\s+\[\s*\d+%\])?$/ },
  { reason: "passing test lines", re: /^\s*--- PASS: / },
  { reason: "passing test lines", re: /^=== (RUN|PAUSE|CONT|NAME)\s/ },
  { reason: "passing test lines", re: /^test \S.* \.\.\. ok$/ },
  { reason: "passing test lines", re: /^\s*ok \d+ - / },
  { reason: "skipped test lines", re: /^\s*↓\s/ },
  // download / compile / install progress
  { reason: "progress lines", re: /^\s*(Downloading|Downloaded|Collecting|Using cached|Obtaining|Fetching|Resolving|Unpacking|Preparing metadata|Getting requirements|Installing build dependencies|Building wheel|Created wheel|Stored in directory|Requirement already satisfied)\b(?!.*\b(error|failed)\b)/, force: true },
  { reason: "progress lines", re: /^\s*(Compiling|Checking|Fresh|Documenting|Downloaded) \S+ v\d[\w.+-]*( \([^)]*\))?$/, force: true },
  { reason: "progress lines", re: /^\s*(Updating crates\.io index|Locking \d+ packages?|Downloading crates \.\.\.|Blocking waiting for file lock)/ },
  { reason: "progress lines", re: /^\s*(go: downloading|go: finding|go: extracting) / },
  { reason: "progress lines", re: /^\s*[━─═█▉▊▋▌▍▎▏░▒▓#=\-\s]{10,}\s*[\d.]+\s*(\/\s*[\d.]+)?\s*[kMG]?i?B/ },
  { reason: "progress lines", re: /^\s*Progress: resolved \d+/ },
  // npm chatter
  { reason: "npm log noise", re: /^npm (http (fetch|cache)|timing|sill|silly)\b/, force: true },
  { reason: "npm log noise", re: /^npm verbose (cli|title|argv|logfile|cwd|os|node|npm|exit|reify|audit|shouldRetry)\b/, force: true },
  { reason: "npm log noise", re: /^npm info (using|ok|run)\b/ },
  { reason: "funding notices", re: /^\d+ packages? (is|are) looking for funding$|^\s+run `npm fund` for details$/ },
];

function templateOf(line: string): string {
  return line
    .replace(/\b[0-9a-f]{7,40}\b/gi, "H")
    .replace(/\d+(\.\d+)*/g, "#")
    .replace(/(["'`]).*?\1/g, "S");
}

function isImportant(line: string): boolean {
  return IMPORTANT_RE.test(line);
}

function genericFilter(lines: string[], hide: Hide): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const n = NOISE.find((x) => x.re.test(line));
    if (n && (n.force || !isImportant(line))) {
      hide(n.reason);
      continue;
    }
    out.push(line);
  }
  return out;
}

/** Collapse runs of >= 4 consecutive lines that look alike (same template), keeping the first two. */
function collapseSimilar(lines: string[], hide: Hide): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = templateOf(lines[i]);
    let j = i + 1;
    while (j < lines.length && lines[j] !== "" && templateOf(lines[j]) === t && !isImportant(lines[j])) j++;
    const run = j - i;
    if (run >= 4 && lines[i] !== "" && !isImportant(lines[i])) {
      out.push(lines[i], lines[i + 1]);
      const n = run - 2;
      out.push(`  … (+${n} similar line${n === 1 ? "" : "s"})`);
      hide("similar lines", n);
    } else {
      for (let k = i; k < j; k++) out.push(lines[k]);
    }
    i = j;
  }
  return out;
}

/** Keep head + tail + every important line (with one line of context) in the middle. */
function capLines(lines: string[], max: number, hide: Hide): string[] {
  if (lines.length <= max) return lines;
  const head = Math.floor(max * 0.3);
  const tail = Math.floor(max * 0.4);
  const budget = max - head - tail;
  const keep = new Set<number>();
  for (let i = 0; i < head; i++) keep.add(i);
  for (let i = lines.length - tail; i < lines.length; i++) keep.add(i);
  let used = 0;
  for (let i = head; i < lines.length - tail && used < budget; i++) {
    if (isImportant(lines[i])) {
      for (const k of [i - 1, i, i + 1]) if (k >= head && k < lines.length - tail && !keep.has(k)) { keep.add(k); used++; }
    }
  }
  const out: string[] = [];
  let skipped = 0;
  for (let i = 0; i < lines.length; i++) {
    if (keep.has(i)) {
      if (skipped) { out.push(`  … [${skipped} line${skipped === 1 ? "" : "s"} omitted]`); hide("omitted for length", skipped); skipped = 0; }
      out.push(lines[i]);
    } else skipped++;
  }
  if (skipped) { out.push(`  … [${skipped} lines omitted]`); hide("omitted for length", skipped); }
  return out;
}

// ---------------------------------------------------------------- rules

const gitStatus: Rule = {
  name: "git-status",
  command: /^git\s+(-C\s+\S+\s+)?status(\s|$)(?!.*(--short|-s\b|--porcelain))/,
  sniff: (t) => /^On branch \S+/m.test(t) && /(Changes (not staged|to be committed)|Untracked files|nothing to commit)/.test(t),
  apply(lines, hide) {
    const out: string[] = [];
    const groups: Record<string, string[]> = {};
    const order: string[] = [];
    let section = "";
    const codes: Record<string, string> = {
      "modified": "M", "new file": "A", "deleted": "D", "renamed": "R", "copied": "C", "typechange": "T",
      "both modified": "UU", "both added": "AA", "both deleted": "DD", "added by us": "AU", "added by them": "UA", "deleted by us": "DU", "deleted by them": "UD",
    };
    const sectionName: Record<string, string> = {
      "Changes to be committed:": "staged", "Changes not staged for commit:": "unstaged", "Untracked files:": "untracked",
      "Unmerged paths:": "conflicts", "Ignored files:": "ignored",
    };
    for (const line of lines) {
      if (sectionName[line]) { section = sectionName[line]; if (!groups[section]) { groups[section] = []; order.push(section); } continue; }
      if (/^\s*\(use "git |^\s*\((commit|fix conflicts|all conflicts) /.test(line)) { hide("git hints"); continue; }
      if (/^no changes added to commit/.test(line)) { hide("git hints"); continue; }
      const m = /^\t(?:([a-z ]+):\s+)?(.+)$/.exec(line);
      if (m && section) {
        const code = m[1] ? codes[m[1]] ?? m[1] : section === "untracked" ? "??" : "!!";
        groups[section].push(`${code} ${m[2]}`);
        continue;
      }
      if (line === "") continue;
      out.push(line);
    }
    for (const s of order) {
      const items = groups[s];
      const shown = items.slice(0, 40);
      out.push(`${s} (${items.length}): ${shown.join(", ")}${items.length > shown.length ? `, … +${items.length - shown.length} more` : ""}`);
      if (items.length > shown.length) hide("status entries", items.length - shown.length);
    }
    return { lines: out, generic: false };
  },
};

const gitLog: Rule = {
  name: "git-log",
  command: /^git\s+(-C\s+\S+\s+)?log(?!.*(--oneline|--pretty|--format|-p\b|--patch|--stat))/,
  sniff: (t) => /^commit [0-9a-f]{40}/m.test(t) && /^(Author|Date):/m.test(t),
  apply(lines, hide) {
    const out: string[] = [];
    let cur: { sha: string; deco: string; author: string; date: string; subject: string; body: number } | null = null;
    const flush = () => {
      if (!cur) return;
      out.push(`${cur.sha.slice(0, 8)} ${cur.date} ${cur.author}: ${cur.subject}${cur.deco ? ` ${cur.deco}` : ""}`);
      if (cur.body) hide("commit message bodies", cur.body);
    };
    for (const line of lines) {
      let m: RegExpExecArray | null;
      if ((m = /^commit ([0-9a-f]{7,40})(?:\s+(\(.*\)))?$/.exec(line))) {
        flush();
        cur = { sha: m[1], deco: m[2] ?? "", author: "", date: "", subject: "", body: 0 };
      } else if (!cur) {
        out.push(line);
      } else if ((m = /^Author:\s+(.*?)\s*(<[^>]*>)?$/.exec(line))) {
        cur.author = m[1];
      } else if ((m = /^(?:Date|AuthorDate):\s+(.*)$/.exec(line))) {
        const d = new Date(m[1]);
        cur.date = Number.isNaN(d.getTime()) ? m[1] : d.toISOString().slice(0, 10);
      } else if (/^Merge:\s/.test(line) || /^(Commit|CommitDate):/.test(line)) {
        // dropped
      } else if (/^ {4}/.test(line)) {
        const text = line.trim();
        if (!cur.subject && text) cur.subject = text;
        else if (text) cur.body++;
      } else if (line !== "") {
        // Not part of a commit block (e.g. a trailing message); pass it through untouched.
        flush();
        cur = null;
        out.push(line);
      }
    }
    flush();
    return { lines: out, generic: false, maxLines: 200 };
  },
};

const gitDiff: Rule = {
  name: "git-diff",
  command: /^git\s+(-C\s+\S+\s+)?(diff|show)(?!.*(--stat|--name-only|--name-status|--shortstat|--numstat))/,
  sniff: (t) => /^diff --git /m.test(t),
  apply(lines, hide) {
    // Drop index lines and redundant ---/+++ headers; trim unchanged context to 1 line around each change.
    const out: string[] = [];
    let hunk: string[] | null = null;
    const isCtx = (l: string) => l.startsWith(" ") || l === "";
    const flushHunk = () => {
      if (!hunk) return;
      const h = hunk;
      hunk = null;
      let i = 0;
      while (i < h.length) {
        if (!isCtx(h[i])) { out.push(h[i]); i++; continue; }
        let j = i;
        while (j < h.length && isCtx(h[j])) j++;
        const run = h.slice(i, j);
        const leading = i === 0, trailing = j === h.length;
        let keep: string[];
        if (leading && trailing) keep = run.slice(0, 1);
        else if (leading) keep = run.slice(-1);
        else if (trailing) keep = run.slice(0, 1);
        else keep = run.length <= 3 ? run : [run[0], " ⋯", run[run.length - 1]];
        const dropped = run.length - keep.filter((k) => k !== " ⋯").length;
        if (dropped > 0) hide("unchanged context lines", dropped);
        out.push(...keep);
        i = j;
      }
    };
    let deletedFile = false;
    let deletedLines = 0;
    const flushDeleted = () => {
      if (deletedLines) { out.push(`(file deleted: ${deletedLines} lines removed)`); hide("lines of deleted files", deletedLines); }
      deletedLines = 0;
    };
    for (const line of lines) {
      if (/^diff --git /.test(line)) { flushHunk(); flushDeleted(); deletedFile = false; }
      if (/^deleted file mode /.test(line)) deletedFile = true;
      if (deletedFile && (/^@@ /.test(line) || (/^-/.test(line) && !/^--- /.test(line)) || (line === "" && deletedLines))) {
        if (!/^@@ /.test(line)) deletedLines++;
        continue;
      }
      if (/^@@ /.test(line)) { flushHunk(); out.push(line); hunk = []; continue; }
      if (hunk && (/^[ +\\-]/.test(line) || line === "")) { hunk.push(line); continue; }
      flushHunk();
      if (/^index [0-9a-f]+\.\.[0-9a-f]+/.test(line)) { hide("diff headers"); continue; }
      if (/^(---|\+\+\+) ((a|b)\/|\/dev\/null$)/.test(line)) { hide("diff headers"); continue; }
      out.push(line);
    }
    flushHunk();
    flushDeleted();
    return { lines: out, generic: false, maxLines: 600 };
  },
};

const npmInstall: Rule = {
  name: "npm-install",
  command: /^(npm|pnpm|yarn|bun)\s+(i|install|add|ci|update|up|upgrade)(\s|$)/,
  sniff: (t) => /^(added|removed|changed|up to date)\b.*\bpackages?\b/m.test(t) && /^npm /m.test(t),
  apply(lines, hide) {
    const deprecated: string[] = [];
    const out: string[] = [];
    for (const line of lines) {
      const m = /^(?:npm (?:warn|WARN) deprecated|\s*WARN\s+deprecated)\s+(\S+?):\s/.exec(line);
      if (m) { deprecated.push(m[1]); continue; }
      out.push(line);
    }
    if (deprecated.length) {
      out.unshift(`npm warn deprecated (${deprecated.length}): ${deprecated.join(", ")}`);
      hide("deprecation details", deprecated.length);
    }
    return { lines: out };
  },
};

const pytest: Rule = {
  name: "pytest",
  command: /^(pytest|py\.test)(\s|$)/,
  sniff: (t) => /^=+ test session starts =+$/m.test(t),
  apply(lines, hide) {
    const out = lines.filter((l) => {
      if (/^(platform \w+ -- Python|cachedir:|rootdir:|configfile:|plugins:|asyncio: mode)/.test(l)) { hide("pytest header"); return false; }
      return true;
    });
    return { lines: out };
  },
};

const RULES: Rule[] = [gitStatus, gitLog, gitDiff, npmInstall, pytest];

export function pickRule(command: string | undefined, text: string): Rule | undefined {
  // Compound shell commands mix several outputs; only content sniffing is safe there.
  if (command && !/&&|\|\||;|\|/.test(command)) {
    const c = normalizeCommand(command);
    const byCmd = RULES.find((r) => r.command?.test(c));
    if (byCmd) return byCmd;
  }
  return RULES.find((r) => r.sniff?.(text));
}

// ---------------------------------------------------------------- main entry

export function compress(raw: string, opts: CompressOptions = {}): CompressResult {
  const hidden: Record<string, number> = {};
  const hide: Hide = (reason, n = 1) => { hidden[reason] = (hidden[reason] ?? 0) + n; };
  const cleaned = clean(raw);
  const linesBefore = raw === "" ? 0 : raw.replace(/\r?\n$/, "").split("\n").length;
  const rule = pickRule(opts.command, cleaned.join("\n"));
  let lines = cleaned;
  let generic = true;
  let max = opts.maxLines ?? 150;
  if (rule) {
    const r = rule.apply(lines, hide);
    lines = r.lines;
    if (r.generic === false) generic = false;
    if (r.maxLines && opts.maxLines === undefined) max = r.maxLines;
  }
  if (generic) {
    lines = genericFilter(lines, hide);
    lines = collapseSimilar(lines, hide);
  }
  // Removing lines can leave blank runs behind.
  lines = lines.filter((l, i) => !(l === "" && (i === 0 || lines[i - 1] === "")));
  lines = capLines(lines, max, hide);
  const lossy = Object.keys(hidden).length > 0;
  return { text: lines.join("\n"), rule: rule?.name ?? "generic", linesBefore, linesAfter: lines.length, hidden, lossy };
}

/** One-line human summary of what was hidden, e.g. "75 passing test lines, 15 progress lines". */
export function describeHidden(hidden: Record<string, number>): string {
  return Object.entries(hidden).map(([k, v]) => `${v} ${k}`).join(", ");
}
