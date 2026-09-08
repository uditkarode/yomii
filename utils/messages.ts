import type { PosGroup } from './pos';

/** [start, end, group, dictionary form, reading, normalized form]; start/end are UTF-16 offsets into the source string. */
export type Span = [number, number, PosGroup, string, string, string];

export interface LookupQuery {
  surface: string;
  dictionaryForm: string;
  normalizedForm: string;
  /** Hiragana reading. */
  reading: string;
  group: PosGroup;
}

export interface LookupSense {
  partOfSpeech: string[];
  glosses: string[];
  misc: string[];
}

export interface LookupEntry {
  headword: string;
  reading: string;
  common: boolean;
  senses: LookupSense[];
}

export interface KanjiExample {
  word: string;
  reading: string;
  gloss: string;
  common: boolean;
}

export interface KanjiReading {
  reading: string;
  /** Best-known word that uses this reading, when one exists. */
  example: KanjiExample | null;
}

export interface KanjiInfo {
  literal: string;
  on: KanjiReading[];
  kun: KanjiReading[];
  meanings: string[];
}

export interface LookupResult {
  entry: LookupEntry | null;
  /** JLPT level 5 (easiest) to 1, when the word is on a list. */
  jlpt: number | null;
  kanji: KanjiInfo[];
}

export type Message =
  | { type: 'tokenize'; texts: string[] }
  | ({ type: 'lookup' } & LookupQuery)
  | { type: 'get-state' }
  | { type: 'set-enabled'; enabled: boolean };

export type TokenizeResponse = Span[][];

export interface PageState {
  enabled: boolean;
}
