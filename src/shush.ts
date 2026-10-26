import { compress, describeHidden, stripAnsi, type CompressOptions } from "./compress.js";
import { saveFull, record } from "./store.js";
import { countTokens } from "./tokens.js";

export interface ShushResult {
  text: string;
  footer: string;
  rule: string;
  tokensBefore: number;
  tokensAfter: number;
  id?: string;
}

/** Compress, save the full output if anything was dropped, record savings and build the footer line. */
export function shush(raw: string, opts: CompressOptions & { save?: boolean; record?: boolean } = {}): ShushResult {
  const r = compress(raw, opts);
  const tokensBefore = countTokens(raw);
  let text = r.text;
  let tokensAfter = countTokens(text);
  let lossy = r.lossy;
  // Never make things worse: if compression did not help, pass the output through (minus color codes).
  if (tokensAfter >= tokensBefore) {
    text = stripAnsi(raw).replace(/\s+$/, "");
    tokensAfter = countTokens(text);
    lossy = false;
  }
  let id: string | undefined;
  if (lossy && opts.save !== false) id = saveFull(raw, opts.command);
  const parts: string[] = [];
  if (opts.exitCode !== undefined && opts.exitCode !== null) parts.push(`exit ${opts.exitCode}`);
  if (tokensBefore > 0 && !lossy && tokensAfter >= tokensBefore) {
    parts.push(`${tokensBefore.toLocaleString("en-US")} tokens, nothing to trim`);
  } else if (tokensBefore > 0) {
    const pct = Math.round(((tokensBefore - tokensAfter) / tokensBefore) * 100);
    parts.push(`${tokensBefore.toLocaleString("en-US")} → ${tokensAfter.toLocaleString("en-US")} tokens (${pct >= 0 ? "-" : "+"}${Math.abs(pct)}%)`);
  }
  if (lossy) parts.push(`hidden: ${describeHidden(r.hidden)}`);
  if (id) parts.push(`full output: shush show ${id}`);
  const footer = `[shush] ${parts.join(" · ")}`;
  if (opts.record !== false) record({ ts: new Date().toISOString(), command: opts.command ?? "", rule: r.rule, before: tokensBefore, after: tokensAfter });
  return { text, footer, rule: r.rule, tokensBefore, tokensAfter, id };
}
