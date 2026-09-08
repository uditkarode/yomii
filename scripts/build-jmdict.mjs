// Writes a compact lookup file built from the jmdict-simplified English release to public/: jmdict.json holds the
// tags and the list of entry files, and jmdict.<n>.json hold the entries. Entries are split into files under 4 MiB
// because addons.mozilla.org refuses to validate JSON files of 5 MiB or more. Format is documented in utils/jmdict.ts.
import { stat, writeFile } from 'node:fs/promises';
import { loadJmdictSimplified } from './jmdict-simplified.mjs';

const MAX_SENSES = 5;
const MAX_GLOSSES = 5;
const MAX_PART_BYTES = 4 * 1024 * 1024;

const publicDir = new URL('../public/', import.meta.url);
const output = new URL('jmdict.json', publicDir);

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
const parts = [];
let chunk = [];
let chunkBytes = 0;
const flush = async () => {
  const name = `jmdict.${parts.length}.json`;
  await writeFile(new URL(name, publicDir), JSON.stringify(chunk));
  parts.push(name);
  chunk = [];
  chunkBytes = 0;
};
for (const entry of entries) {
  const bytes = Buffer.byteLength(JSON.stringify(entry)) + 1;
  if (chunk.length > 0 && chunkBytes + bytes > MAX_PART_BYTES) await flush();
  chunk.push(entry);
  chunkBytes += bytes;
}
if (chunk.length > 0) await flush();
await writeFile(output, JSON.stringify({ version: source.version, dictDate: source.dictDate, tags: source.tags, parts }));
let total = 0;
for (const name of parts) total += (await stat(new URL(name, publicDir))).size;
console.log(`wrote ${output.pathname}: ${entries.length} entries in ${parts.length} parts, ${(total / 1e6).toFixed(1)} MB`);
