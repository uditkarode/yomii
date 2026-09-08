import { SudachiStateless, TokenizeMode } from 'sudachi-wasm333';
import type { JlptFile, JmdictEntry, JmdictFile, KanjiFile, KanjiReadingRecord } from '@/utils/jmdict';
import { katakanaToHiragana } from '@/utils/kana';
import type { KanjiInfo, KanjiReading, LookupEntry, LookupQuery, LookupResult, Message, Span, TokenizeResponse } from '@/utils/messages';
import { jmdictPosMatches, posGroup } from '@/utils/pos';

export default defineBackground({
  type: 'module',
  main() {
    let tokenizerPromise: Promise<SudachiStateless> | undefined;

    function getTokenizer(): Promise<SudachiStateless> {
      tokenizerPromise ??= (async () => {
        const response = await fetch(browser.runtime.getURL('/system_small.dic'));
        const bytes = new Uint8Array(await response.arrayBuffer());
        const tokenizer = new SudachiStateless();
        tokenizer.initialize_from_bytes(bytes);
        return tokenizer;
      })();
      return tokenizerPromise;
    }

    function tokenize(tokenizer: SudachiStateless, text: string): Span[] {
      const spans: Span[] = [];
      for (const chunk of chunkForSudachi(text)) {
        const morphemes = tokenizer.tokenize_raw(chunk.text, TokenizeMode.C);
        if (!Array.isArray(morphemes)) {
          throw new Error(`sudachi: ${JSON.stringify(morphemes)}`);
        }
        const charIndex = utf8ByteToCharIndex(chunk.text);
        for (const morpheme of morphemes) {
          const group = posGroup(morpheme.poses[0] ?? '');
          if (!group) continue;
          const start = charIndex[morpheme.begin];
          const end = charIndex[morpheme.end];
          if (start === undefined || end === undefined) {
            throw new Error(`sudachi: offsets ${morpheme.begin}-${morpheme.end} outside of text`);
          }
          spans.push([chunk.offset + start, chunk.offset + end, group, morpheme.dictionary_form, morpheme.reading_form, morpheme.normalized_form]);
        }
      }
      return spans;
    }

    let dictionaryPromise: Promise<Dictionary> | undefined;

    function getDictionary(): Promise<Dictionary> {
      dictionaryPromise ??= Promise.all([
        fetch(browser.runtime.getURL('/jmdict.json')).then((response) => response.json() as Promise<JmdictFile>),
        fetch(browser.runtime.getURL('/kanji.json')).then((response) => response.json() as Promise<KanjiFile>),
        fetch(browser.runtime.getURL('/jlpt.json')).then((response) => response.json() as Promise<JlptFile>),
      ]).then(([jmdict, kanji, jlpt]) => new Dictionary(jmdict, kanji, jlpt));
      return dictionaryPromise;
    }

    browser.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
      if (message.type === 'tokenize') {
        getTokenizer()
          .then((tokenizer) => {
            const response: TokenizeResponse = message.texts.map((text) => tokenize(tokenizer, text));
            sendResponse(response);
          })
          .catch((error) => {
            console.error(error);
            sendResponse(null);
          });
        return true;
      }
      if (message.type === 'lookup') {
        getDictionary()
          .then((dictionary) => sendResponse(dictionary.lookup(message)))
          .catch((error) => {
            console.error(error);
            sendResponse(null);
          });
        return true;
      }
    });
  },
});

/** Sudachi rejects inputs over 49,149 UTF-8 bytes, so long text is cut into pieces at sentence or line breaks. */
const MAX_CHUNK_BYTES = 32_000;
const CHUNK_BREAKS = /[。．！？!?\n]/g;

function chunkForSudachi(text: string): { text: string; offset: number }[] {
  if (utf8Length(text) <= MAX_CHUNK_BYTES) return [{ text, offset: 0 }];
  const chunks: { text: string; offset: number }[] = [];
  let start = 0;
  let lastBreak = -1;
  let bytes = 0;
  for (let i = 0; i < text.length; ) {
    const codePoint = text.codePointAt(i)!;
    const width = codePoint >= 0x10000 ? 2 : 1;
    const size = codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
    if (bytes + size > MAX_CHUNK_BYTES) {
      const cut = lastBreak > start ? lastBreak : i;
      chunks.push({ text: text.slice(start, cut), offset: start });
      start = cut;
      lastBreak = -1;
      bytes = utf8Length(text.slice(start, i));
    }
    bytes += size;
    CHUNK_BREAKS.lastIndex = 0;
    if (CHUNK_BREAKS.test(text.slice(i, i + width))) lastBreak = i + width;
    i += width;
  }
  chunks.push({ text: text.slice(start), offset: start });
  return chunks;
}

/** Sudachi reports offsets in UTF-8 bytes; this maps each byte offset to the UTF-16 index JS strings use. */
function utf8ByteToCharIndex(text: string): Uint32Array {
  const map = new Uint32Array(utf8Length(text) + 1);
  let byte = 0;
  for (let i = 0; i < text.length; ) {
    const codePoint = text.codePointAt(i)!;
    map[byte] = i;
    byte += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
    i += codePoint >= 0x10000 ? 2 : 1;
  }
  map[byte] = text.length;
  return map;
}

function utf8Length(text: string): number {
  let length = 0;
  for (let i = 0; i < text.length; ) {
    const codePoint = text.codePointAt(i)!;
    length += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
    i += codePoint >= 0x10000 ? 2 : 1;
  }
  return length;
}

const KANJI = /\p{Script=Han}/u;

/** JMdict entries indexed by every kanji and kana form, plus per-kanji and JLPT data. */
class Dictionary {
  private readonly index = new Map<string, JmdictEntry[]>();

  constructor(
    private readonly file: JmdictFile,
    private readonly kanji: KanjiFile,
    private readonly jlpt: JlptFile,
  ) {
    for (const entry of file.entries) {
      for (const form of [...entry[0], ...entry[1]]) {
        const list = this.index.get(form);
        if (list) list.push(entry);
        else this.index.set(form, [entry]);
      }
    }
  }

  lookup(query: LookupQuery): LookupResult {
    const entry = this.findEntry(query);
    const reading = katakanaToHiragana(query.reading);
    const keys = [
      `${query.dictionaryForm}|${reading}`,
      query.dictionaryForm,
      `${query.normalizedForm}|${reading}`,
      query.normalizedForm,
      reading,
    ];
    const jlpt = keys.map((key) => this.jlpt.levels[key]).find((level) => level !== undefined) ?? null;
    const literals = [...new Set([...(entry?.headword ?? ''), ...query.surface].filter((char) => KANJI.test(char)))];
    const kanji: KanjiInfo[] = [];
    for (const literal of literals) {
      const info = this.kanji.kanji[literal];
      if (info) kanji.push({ literal, on: info[0].map(toKanjiReading), kun: info[1].map(toKanjiReading), meanings: info[2] });
    }
    return { entry, jlpt, kanji };
  }

  private findEntry(query: LookupQuery): LookupEntry | null {
    const reading = katakanaToHiragana(query.reading);
    const forms = new Set([query.dictionaryForm, query.normalizedForm, katakanaToHiragana(query.dictionaryForm)]);
    const candidates = new Set<JmdictEntry>();
    for (const form of forms) for (const entry of this.index.get(form) ?? []) candidates.add(entry);
    if (candidates.size === 0) for (const entry of this.index.get(reading) ?? []) candidates.add(entry);

    let best: JmdictEntry | undefined;
    let bestScore = -1;
    for (const entry of candidates) {
      const [kanji, kana, common, senses] = entry;
      let score = 0;
      if (kanji.some((form) => forms.has(form))) score += 4;
      if (kana.some((form) => forms.has(form) || form === reading)) score += 3;
      if (senses.some(([pos]) => pos.some((code) => jmdictPosMatches(query.group, code)))) score += 2;
      if (common) score += 1;
      if (score > bestScore) {
        best = entry;
        bestScore = score;
      }
    }
    if (!best) return null;

    const [kanji, kana, common, senses] = best;
    return {
      headword: kanji[0] ?? kana[0] ?? query.dictionaryForm,
      reading: kana.find((form) => form === reading) ?? kana[0] ?? reading,
      common: common === 1,
      senses: senses.map(([pos, glosses, misc]) => ({
        partOfSpeech: pos.map((code) => this.describe(code)),
        glosses,
        misc: misc.map((code) => this.describe(code)),
      })),
    };
  }

  private describe(code: string): string {
    return (this.file.tags[code] ?? code).replace(/\s*\([^)]*\)/g, '').trim();
  }
}

function toKanjiReading([reading, example]: KanjiReadingRecord): KanjiReading {
  return {
    reading,
    example: example ? { word: example[0], reading: example[1], gloss: example[2], common: example[3] === 1 } : null,
  };
}
