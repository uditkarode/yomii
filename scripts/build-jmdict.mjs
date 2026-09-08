// Writes a compact lookup file built from the jmdict-simplified English release to public/jmdict.json.
// Format is documented in utils/jmdict.ts.
import { stat, writeFile } from 'node:fs/promises';
import { loadJmdictSimplified } from './jmdict-simplified.mjs';

const MAX_SENSES = 5;
const MAX_GLOSSES = 5;

const output = new URL('../public/jmdict.json', import.meta.url);

const source = await loadJmdictSimplified('jmdict-eng');
const entries = source.words.map((word) => [
  word.kanji.map((form) => form.text),
  word.kana.map((form) => form.text),
  word.kanji.some((form) => form.common) || word.kana.some((form) => form.common) ? 1 : 0,
  word.sense.slice(0, MAX_SENSES).map((sense) => [
    sense.partOfSpeech,
    sense.gloss.map((gloss) => gloss.text).slice(0, MAX_GLOSSES),
    sense.misc,
  ]),
]);
const file = { version: source.version, dictDate: source.dictDate, tags: source.tags, entries };
await writeFile(output, JSON.stringify(file));
console.log(`wrote ${output.pathname}: ${entries.length} entries, ${((await stat(output)).size / 1e6).toFixed(1)} MB`);
