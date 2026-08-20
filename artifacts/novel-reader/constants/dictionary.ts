// dictionary.ts
export type DictionaryEntry = {
  meaning: string;
  pos?: string;
};

import { DICTIONARY_A } from "./dict/dictionary_a";
import { DICTIONARY_B } from "./dict/dictionary_b";
import { DICTIONARY_C } from "./dict/dictionary_c";
import { DICTIONARY_D } from "./dict/dictionary_d";
import { DICTIONARY_E } from "./dict/dictionary_e";
import { DICTIONARY_F } from "./dict/dictionary_f";
import { DICTIONARY_G } from "./dict/dictionary_g";
import { DICTIONARY_H } from "./dict/dictionary_h";
import { DICTIONARY_I } from "./dict/dictionary_i";
import { DICTIONARY_J } from "./dict/dictionary_j";
import { DICTIONARY_K } from "./dict/dictionary_k";
import { DICTIONARY_L } from "./dict/dictionary_l";
import { DICTIONARY_M } from "./dict/dictionary_m";
import { DICTIONARY_N } from "./dict/dictionary_n";
import { DICTIONARY_O } from "./dict/dictionary_o";
import { DICTIONARY_P } from "./dict/dictionary_p";
import { DICTIONARY_Q } from "./dict/dictionary_q";
import { DICTIONARY_R } from "./dict/dictionary_r";
import { DICTIONARY_S } from "./dict/dictionary_s";
import { DICTIONARY_T } from "./dict/dictionary_t";
import { DICTIONARY_U } from "./dict/dictionary_u";
import { DICTIONARY_V } from "./dict/dictionary_v"; // <-- ADD THIS
import { DICTIONARY_W } from "./dict/dictionary_w";
import { DICTIONARY_X } from "./dict/dictionary_x";
import { DICTIONARY_Y } from "./dict/dictionary_y";
import { DICTIONARY_Z } from "./dict/dictionary_z";

export const SIMPLE_DICTIONARY: Record<string, DictionaryEntry> = {
  ...DICTIONARY_A,
  ...DICTIONARY_B,
  ...DICTIONARY_C,
  ...DICTIONARY_D,
  ...DICTIONARY_E,
  ...DICTIONARY_F,
  ...DICTIONARY_G,
  ...DICTIONARY_H,
  ...DICTIONARY_I,
  ...DICTIONARY_J,
  ...DICTIONARY_K,
  ...DICTIONARY_L,
  ...DICTIONARY_M,
  ...DICTIONARY_N,
  ...DICTIONARY_O,
  ...DICTIONARY_P,
  ...DICTIONARY_Q,
  ...DICTIONARY_R,
  ...DICTIONARY_S,
  ...DICTIONARY_T,
  ...DICTIONARY_U,
  ...DICTIONARY_V, // <-- ADD THIS
  ...DICTIONARY_W,
  ...DICTIONARY_X,
  ...DICTIONARY_Y,
  ...DICTIONARY_Z,
};
