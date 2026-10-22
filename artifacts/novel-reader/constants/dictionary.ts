// dictionary.ts
export type DictionaryEntry = {
  meaning: string;
  pos?: string;
};

type RawDictionary = Record<string, DictionaryEntry>;
type GroupedDictionary = Record<string, DictionaryEntry[]>;

// Each letter file is only required (evaluated) the first time a word
// starting with that letter is looked up. Previously all 26 files (~18k
// entries) were imported and merged at app launch, which delayed startup on
// low-end phones. Output is identical: every key already starts with its
// file's letter.
const LOADERS: Record<string, () => RawDictionary> = {
  a: () => require("./dict/dictionary_a").DICTIONARY_A,
  b: () => require("./dict/dictionary_b").DICTIONARY_B,
  c: () => require("./dict/dictionary_c").DICTIONARY_C,
  d: () => require("./dict/dictionary_d").DICTIONARY_D,
  e: () => require("./dict/dictionary_e").DICTIONARY_E,
  f: () => require("./dict/dictionary_f").DICTIONARY_F,
  g: () => require("./dict/dictionary_g").DICTIONARY_G,
  h: () => require("./dict/dictionary_h").DICTIONARY_H,
  i: () => require("./dict/dictionary_i").DICTIONARY_I,
  j: () => require("./dict/dictionary_j").DICTIONARY_J,
  k: () => require("./dict/dictionary_k").DICTIONARY_K,
  l: () => require("./dict/dictionary_l").DICTIONARY_L,
  m: () => require("./dict/dictionary_m").DICTIONARY_M,
  n: () => require("./dict/dictionary_n").DICTIONARY_N,
  o: () => require("./dict/dictionary_o").DICTIONARY_O,
  p: () => require("./dict/dictionary_p").DICTIONARY_P,
  q: () => require("./dict/dictionary_q").DICTIONARY_Q,
  r: () => require("./dict/dictionary_r").DICTIONARY_R,
  s: () => require("./dict/dictionary_s").DICTIONARY_S,
  t: () => require("./dict/dictionary_t").DICTIONARY_T,
  u: () => require("./dict/dictionary_u").DICTIONARY_U,
  v: () => require("./dict/dictionary_v").DICTIONARY_V,
  w: () => require("./dict/dictionary_w").DICTIONARY_W,
  x: () => require("./dict/dictionary_x").DICTIONARY_X,
  y: () => require("./dict/dictionary_y").DICTIONARY_Y,
  z: () => require("./dict/dictionary_z").DICTIONARY_Z,
};

const cache: Record<string, GroupedDictionary> = {};

// Extract base word from keys like "contract1", "contract2" -> "contract"
function getBaseWord(key: string): string {
  return key.replace(/\d+$/, "");
}

function loadLetter(letter: string): GroupedDictionary | undefined {
  const cached = cache[letter];
  if (cached) return cached;

  const loader = LOADERS[letter];
  if (!loader) return undefined;

  // Multi-entry dictionary for this letter: base word -> array of meanings
  const grouped: GroupedDictionary = {};
  for (const [key, entry] of Object.entries(loader())) {
    const baseWord = getBaseWord(key);
    (grouped[baseWord] ??= []).push(entry);
  }
  cache[letter] = grouped;
  return grouped;
}

export function lookupWord(word: string): DictionaryEntry[] | undefined {
  // Exact-key lookup, same as the old merged object; only the file choice
  // is case-insensitive.
  return loadLetter(word.charAt(0).toLowerCase())?.[word];
}
