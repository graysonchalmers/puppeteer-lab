// scripts/build-stamp/lists.mjs
// Frozen source of truth for the build-stamp derivation. See
// docs/superpowers/specs/2026-09-06-build-stamp-standard-design.md.
// Changing either list re-maps every commit, so treat these as immutable.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// 128 single-code-point emoji (no ZWJ or skin-tone modifiers so every
// platform renders the same glyph), ordered and frozen.
export const EMOJI_LIST = Object.freeze([
  '🦑','🐙','🦐','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐢','🦎','🐍','🦖',
  '🦕','🐉','🦩','🦚','🦜','🦉','🦅','🐧','🐦','🐤','🦆','🦢','🕊','🦇','🐺','🦊',
  '🦝','🐱','🦁','🐯','🐴','🦄','🦓','🦌','🐮','🐷','🐗','🐫','🦙','🦒','🐘','🦏',
  '🐭','🐹','🐰','🐿','🦔','🦥','🦦','🦨','🐾','🦋','🐌','🐛','🐜','🐝','🐞','🦗',
  '🌵','🌲','🌳','🌴','🌱','🍀','🍁','🍄','🌰','🦂','🌸','🌼','🌻','🌙','⭐','🔥',
  '❄','🌈','💧','🌊','⚡','☄','🪐','🌍','🍎','🍊','🍋','🍉','🍇','🍓','🍒','🍑',
  '🥝','🍍','🥥','🌽','🥕','🥭','🌶','🧀','🍰','🍩','🍪','🍫','🍬','🍭','☕','🍵',
  '⚓','🚀','🛸','🎈','🎲','🧭','🔑','💎','🔔','🎁','🪁','🎯','🧩','🎸','🎺','🥁',
]);

const words = readFileSync(join(here, 'bip39-1024.txt'), 'utf8')
  .split(/\r?\n/).map(w => w.trim()).filter(Boolean);
export const WORD_LIST = Object.freeze(words);

export default { EMOJI_LIST, WORD_LIST };
