/** Compact JMdict manifest written by scripts/build-jmdict.mjs; the entries live in the listed part files. */
export interface JmdictFile {
  version: string;
  dictDate: string;
  /** Part-of-speech and misc tag codes to descriptions. */
  tags: Record<string, string>;
  /** Files in public/ that each hold a JmdictEntry[]. */
  parts: string[];
}

/** [kanji forms, kana forms, common, senses] */
export type JmdictEntry = [string[], string[], 0 | 1, JmdictSense[]];

/** [part-of-speech codes, glosses, misc codes] */
export type JmdictSense = [string[], string[], string[]];

/** Compact per-kanji file written by scripts/build-kanji.mjs. */
export interface KanjiFile {
  version: string;
  dictDate: string;
  /** literal -> [on readings, kun readings, meanings, school grade, JLPT level (pre-2010 scale)] */
  kanji: Record<string, [KanjiReadingRecord[], KanjiReadingRecord[], string[], number | null, number | null]>;
}

/** [reading, best-known word using it] */
export type KanjiReadingRecord = [string, KanjiExampleRecord | null];

/** [word, kana, first gloss, common] */
export type KanjiExampleRecord = [string, string, string, 0 | 1];

/** Sudachi dictionary parts written by scripts/fetch-sudachi-dict.mjs; the parts joined in order are system_small.dic. */
export interface SudachiDictManifest {
  version: string;
  size: number;
  parts: string[];
}

/** JLPT vocabulary levels written by scripts/build-jlpt.mjs. */
export interface JlptFile {
  source: string;
  /** "word|reading" and "word" -> level 5 (easiest) to 1 */
  levels: Record<string, number>;
}
