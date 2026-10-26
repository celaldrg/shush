import { encode } from "gpt-tokenizer";

/**
 * Token count using the o200k_base tokenizer (GPT-4o family) as a model-neutral yardstick.
 * Other models tokenize differently, but the relative savings are similar.
 * Very large inputs are estimated (chars / 4) to stay fast.
 */
export function countTokens(text: string): number {
  if (!text) return 0;
  if (text.length > 2_000_000) return Math.ceil(text.length / 4);
  try {
    return encode(text, { allowedSpecial: "all" }).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}
