// Writes a compact per-kanji file to public/kanji.json (format in utils/jmdict.ts): readings, meanings, school grade,
// JLPT level, and for each reading one example word.
//
// Readings: for the 2136 jōyō kanji they come from the official Jōyō kanji table (平成22年内閣告示第2号) as transcribed in
// Wikipedia's "List of jōyō kanji", so archaic and non-standard readings are left out. Other kanji keep their
// KANJIDIC2 readings.
// Examples: JmdictFurigana says which reading each kanji has inside each JMdict word. Among the words using a reading,
// the best-known one wins, judged by the tanos JLPT lists and JMdict's newspaper frequency tags (nf01..nf48, only
// present in the JMdict XML).
import { readFile, stat, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { cacheDir, download, exists, loadJmdictSimplified } from './jmdict-simplified.mjs';

const JOYO_REVISION = 1351700992;
const JOYO_COUNT = 2136;
const FURIGANA_VERSION = '2.3.1+2026-08-25';
const MAX_READINGS = 4;
const MAX_MEANINGS = 4;
// The table lists these kanji under their official glyphs; web pages use the simpler variants, which Unicode encodes separately.
const JOYO_VARIANTS = { '𠮟': '叱', '剝': '剥', '頰': '頬', '塡': '填' };
// Rarely used kanji forms (rK) stay: words usually written in kana, such as 居る, are still the right example for their kanji.
const SKIPPED_KANJI_TAGS = new Set(['sK', 'iK', 'oK', 'io']);
const SKIPPED_KANA_TAGS = new Set(['sk', 'rk', 'ik', 'ok', 'gikun']);
const ARCHAIC_MISC = new Set(['arch', 'obs', 'rare']);
// Added to a word's frequency rank: words a learner meets later are less likely to be the one they know.
const JLPT_PENALTY = { 5: 0, 4: 2, 3: 4, 2: 6, 1: 8 };
const NO_JLPT_PENALTY = 20;

const joyoFile = new URL(`joyo/list-of-joyo-kanji-${JOYO_REVISION}.json`, cacheDir);
const furiganaFile = new URL(`furigana/JmdictFurigana-${FURIGANA_VERSION}.txt`, cacheDir);
const jmdictXmlFile = new URL('jmdict/JMdict_e.gz', cacheDir);
const jlptFile = new URL('../public/jlpt.json', import.meta.url);
const output = new URL('../public/kanji.json', import.meta.url);

if (!(await exists(jlptFile))) throw new Error('public/jlpt.json is missing; run scripts/build-jlpt.mjs first');
await download(
  `https://en.wikipedia.org/w/api.php?action=parse&oldid=${JOYO_REVISION}&prop=wikitext&format=json&formatversion=2`,
  joyoFile,
  { 'User-Agent': 'yomii-build/0.1 (browser extension data build script)' },
);
await download(`https://github.com/Doublevil/JmdictFurigana/releases/download/${encodeURIComponent(FURIGANA_VERSION)}/JmdictFurigana.txt`, furiganaFile);
// EDRDG regenerates this file daily; only its priority tags are read, and those rarely change.
await download('http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz', jmdictXmlFile);

function katakanaToHiragana(text) {
  return text.replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/g, ' ');
}

// Rows look like `|55||…|[[wikt:飲#Japanese|飲]]||…||イン、の-む<br>in, no-mu`. Katakana entries are on readings and
// hiragana ones kun readings, with a hyphen before the okurigana. Parenthesized readings are the table's
// 「特別なものか、又は用法のごく狭いもの」 and are kept.
function parseJoyoReadings(wikitext) {
  const joyo = {};
  const ids = new Set();
  for (const row of decodeEntities(wikitext).split('\n|-')) {
    const text = row.trim().split('\n|}')[0];
    const id = text.match(/^\|(\d+)\|\|/)?.[1];
    if (!id) continue;
    const literal = text.match(/\[\[wikt:(\p{Script=Han})#Japanese\|/u)?.[1];
    if (!literal) throw new Error(`jōyō row without a kanji: ${text.slice(0, 80)}`);
    const cell = text.split('||').at(-1).split('<br>')[0].replace(/<ref[^>]*\/>|<ref[^>]*>.*?<\/ref>/gs, '');
    const on = [];
    const kun = [];
    for (const raw of cell.split('、')) {
      const reading = raw.replace(/[（）\s]/g, '');
      if (/^[ァ-ヺー]+$/u.test(reading)) on.push(reading);
      else if (/^[ぁ-ゖー]+(-[ぁ-ゖー]+)*$/u.test(reading)) kun.push(reading.replaceAll('-', '.'));
      else throw new Error(`unexpected jōyō reading ${JSON.stringify(raw)} for ${literal}`);
    }
    ids.add(Number(id));
    joyo[literal] = { on, kun };
  }
  const count = Object.keys(joyo).length;
  if (count !== JOYO_COUNT || ids.size !== JOYO_COUNT || Math.max(...ids) !== JOYO_COUNT) {
    throw new Error(`parsed ${count} jōyō kanji with ${ids.size} row numbers, expected ${JOYO_COUNT}`);
  }
  for (const [official, variant] of Object.entries(JOYO_VARIANTS)) joyo[variant] = joyo[official];
  return joyo;
}

// JMdict marks well-known forms with nf01..nf48 (bands of 500 words in a newspaper frequency count, lower is more
// frequent) and with ichi/spec/gai tags from other word lists (1 = top tier, 2 = second tier). Everyday words such as
// 人 (ひと) only carry ichi1, so first-tier tags count as a mid-range newspaper band. 99 means unmarked.
function rankOfPriorities(element) {
  const tags = [...element.matchAll(/<(?:ke|re)_pri>(.*?)<\/(?:ke|re)_pri>/g)].map((match) => match[1]);
  const nf = tags.find((tag) => tag.startsWith('nf'));
  if (nf) return Number(nf.slice(2));
  if (tags.some((tag) => tag.endsWith('1'))) return 12;
  if (tags.length > 0) return 36;
  return 99;
}

// "kanji|kana" -> rank. A pair takes the worse rank of its two forms, so a rare reading of a common word stays rare.
function parseFrequencyRanks(xml) {
  const ranks = new Map();
  for (const entry of xml.split('</entry>')) {
    const kanjiForms = [...entry.matchAll(/<k_ele>(.*?)<\/k_ele>/gs)].map((match) => [match[1].match(/<keb>(.*?)<\/keb>/)[1], rankOfPriorities(match[1])]);
    for (const match of entry.matchAll(/<r_ele>(.*?)<\/r_ele>/gs)) {
      const kana = match[1].match(/<reb>(.*?)<\/reb>/)[1];
      const rank = rankOfPriorities(match[1]);
      const restrictions = [...match[1].matchAll(/<re_restr>(.*?)<\/re_restr>/g)].map((restr) => restr[1]);
      for (const [kanji, kanjiRank] of kanjiForms) {
        if (restrictions.length > 0 && !restrictions.includes(kanji)) continue;
        ranks.set(`${kanji}|${kana}`, Math.max(kanjiRank, rank));
      }
    }
  }
  return ranks;
}

// "kanji|kana" -> example word candidate, skipping rare, irregular and search-only forms.
function indexWords(jmdict, jlpt, ranks) {
  const words = new Map();
  for (const word of jmdict.words) {
    const kanaForms = word.kana.filter((form) => !form.tags.some((tag) => SKIPPED_KANA_TAGS.has(tag)));
    for (const kanjiForm of word.kanji) {
      if (kanjiForm.tags.some((tag) => SKIPPED_KANJI_TAGS.has(tag))) continue;
      for (const kanaForm of kanaForms) {
        if (!kanaForm.appliesToKanji.includes('*') && !kanaForm.appliesToKanji.includes(kanjiForm.text)) continue;
        const key = `${kanjiForm.text}|${kanaForm.text}`;
        if (words.has(key)) continue;
        const applies = (sense) =>
          (sense.appliesToKanji.includes('*') || sense.appliesToKanji.includes(kanjiForm.text)) &&
          (sense.appliesToKana.includes('*') || sense.appliesToKana.includes(kanaForm.text));
        const senses = word.sense.filter(applies);
        const sense = senses.find((s) => !s.misc.some((tag) => ARCHAIC_MISC.has(tag))) ?? senses[0];
        const gloss = sense?.gloss.find((g) => g.lang === 'eng')?.text;
        if (!gloss) continue;
        const level = jlpt.levels[key] ?? 0;
        words.set(key, {
          text: kanjiForm.text,
          kana: kanaForm.text,
          gloss,
          common: kanjiForm.common && kanaForm.common,
          level,
          rank: ranks.get(key) ?? 99,
        });
      }
    }
  }
  return words;
}

// "kanji|kana attached to that kanji" -> words. Lines look like `会食|かいしょく|0:かい;1:しょく`; positions like `0-1`
// are jukujikun spanning several kanji and are skipped.
function indexFurigana(text, words) {
  const index = new Map();
  for (const line of text.split('\n')) {
    const [word, kana, parts] = line.split('|');
    const candidate = words.get(`${word}|${kana}`);
    if (!candidate || !parts) continue;
    for (const part of parts.split(';')) {
      const [position, rt] = part.split(':');
      if (position.includes('-')) continue;
      const key = `${word[Number(position)]}|${katakanaToHiragana(rt)}`;
      const list = index.get(key);
      if (list) list.push(candidate);
      else index.set(key, [candidate]);
    }
  }
  return index;
}

const VOICED = { か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご', さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ', た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど', は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ' };
const SEMI_VOICED = { は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ' };

// Inside compounds a reading's first kana may be voiced (かた -> がた) and a final く/き/つ/ち may become っ (がく -> がっ).
function readingVariants(stem) {
  const variants = [stem];
  const first = stem[0];
  if (VOICED[first]) variants.push(VOICED[first] + stem.slice(1));
  if (SEMI_VOICED[first]) variants.push(SEMI_VOICED[first] + stem.slice(1));
  if (stem.length > 1) for (const variant of [...variants]) if (/[くきつち]$/.test(variant)) variants.push(variant.slice(0, -1) + 'っ');
  return variants;
}

const score = (word) => word.rank + (JLPT_PENALTY[word.level] ?? NO_JLPT_PENALTY);

function compareCandidates(a, b) {
  return score(a) - score(b) || a.rank - b.rank || b.level - a.level || a.text.length - b.text.length;
}

// KANJIDIC2 marks prefix and suffix readings with a hyphen; the jōyō readings have none.
const bare = (reading) => reading.replace(/^-|-$/g, '');
const stemOf = (reading) => katakanaToHiragana(bare(reading).split('.')[0]);

const known = (word) => word.level > 0 || word.common;

/** Best-known word in which `literal` has `reading`; `others` are the kanji's other readings. */
function findExample(literal, reading, others, furigana, isKun) {
  const [stem, okurigana = ''] = bare(reading).split('.');
  const hiraganaStem = katakanaToHiragana(stem);
  const otherStems = new Set(others.map(stemOf));
  // A bare reading such as ひと must not borrow 一つ from ひと.つ.
  const siblingOkurigana = others.map(bare).filter((other) => other.startsWith(`${stem}.`)).map((other) => other.split('.')[1][0]);
  // A kun reading's own word (食べる for た.べる, 上 for うえ) is the clearest example whenever a learner is likely to know it.
  const ownWord = isKun ? literal + okurigana : null;
  let best;
  for (const variant of readingVariants(hiraganaStem)) {
    if (variant !== hiraganaStem && otherStems.has(variant)) continue;
    for (const word of furigana.get(`${literal}|${variant}`) ?? []) {
      if (okurigana && !word.text.includes(literal + okurigana[0])) continue;
      if (!okurigana && siblingOkurigana.some((kana) => word.text.includes(literal + kana))) continue;
      if (word.text === ownWord && known(word)) return toRecord(word);
      if (!best || compareCandidates(word, best) < 0) best = word;
    }
    // Voiced and っ forms only matter when the plain reading has no well-known word.
    if (best && known(best)) break;
  }
  return best ? toRecord(best) : null;
}

const toRecord = (word) => [word.text, word.kana, word.gloss, word.common ? 1 : 0];

const joyo = parseJoyoReadings(JSON.parse(await readFile(joyoFile, 'utf8')).parse.wikitext);
const ranks = parseFrequencyRanks(gunzipSync(await readFile(jmdictXmlFile)).toString('utf8'));
const jlpt = JSON.parse(await readFile(jlptFile, 'utf8'));
const words = indexWords(await loadJmdictSimplified('jmdict-eng'), jlpt, ranks);
const furigana = indexFurigana(await readFile(furiganaFile, 'utf8'), words);
const source = await loadJmdictSimplified('kanjidic2-en');

const kanji = {};
let official = 0;
let readingCount = 0;
let exampleCount = 0;
for (const character of source.characters) {
  const groups = character.readingMeaning?.groups ?? [];
  const readings = groups.flatMap((group) => group.readings);
  const table = joyo[character.literal];
  if (table) official++;
  const on = (table?.on ?? readings.filter((r) => r.type === 'ja_on').map((r) => r.value)).slice(0, MAX_READINGS);
  const kun = (table?.kun ?? readings.filter((r) => r.type === 'ja_kun').map((r) => r.value)).slice(0, MAX_READINGS);
  const meanings = groups.flatMap((group) => group.meanings).filter((m) => m.lang === 'en').map((m) => m.value).slice(0, MAX_MEANINGS);
  if (on.length === 0 && kun.length === 0 && meanings.length === 0) continue;
  const withExamples = (list, isKun) =>
    list.map((reading) => {
      const example = findExample(character.literal, reading, on.concat(kun).filter((other) => other !== reading), furigana, isKun);
      readingCount++;
      if (example) exampleCount++;
      return [reading, example];
    });
  kanji[character.literal] = [withExamples(on, false), withExamples(kun, true), meanings, character.misc.grade ?? null, character.misc.jlptLevel ?? null];
}
if (official !== JOYO_COUNT + Object.keys(JOYO_VARIANTS).length) throw new Error(`jōyō readings applied to ${official} kanji`);
await writeFile(output, JSON.stringify({ version: source.version, dictDate: source.dictDate, kanji }));
console.log(
  `wrote ${output.pathname}: ${Object.keys(kanji).length} kanji (${official} with jōyō readings), ` +
    `${exampleCount}/${readingCount} readings with an example, ${((await stat(output)).size / 1e6).toFixed(1)} MB`,
);
