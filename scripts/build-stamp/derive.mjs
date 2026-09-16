import { EMOJI_LIST, WORD_LIST } from './lists.mjs';

// parseInt on 8 hex chars (max 0xffffffff = 4294967295) is exact in a JS
// Number and a Python int alike, so ports compute the same index.
// `version` is an optional human tag (e.g. package.json version); it is a
// literal display prefix and plays no part in the SHA-derived identity.
export function deriveStamp(sha, date, version) {
  const full = String(sha).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(full)) throw new Error(`not a 40-hex sha: ${sha}`);
  const emojiIndex = parseInt(full.slice(0, 8), 16) % EMOJI_LIST.length;
  const wordIndex = parseInt(full.slice(8, 16), 16) % WORD_LIST.length;
  const emoji = EMOJI_LIST[emojiIndex];
  const codeword = WORD_LIST[wordIndex].toUpperCase();
  const shortSha = full.slice(0, 6);
  const ver = version ? String(version).trim() : '';
  const prefix = ver ? `v${ver} ` : '';
  const stamp = `${prefix}${emoji} ${codeword} · ${shortSha} · ${date}`;
  return { sha: full, shortSha, date, version: ver || null, emoji, codeword, stamp };
}

export default { deriveStamp };
