// Builds public/jlpt.json from the JLPT vocabulary lists compiled by Jonathan Waller (tanos.co.uk, CC BY),
// as packaged in JSON form by the jlpt-vocab-api project. Format is documented in utils/jmdict.ts.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';

const COMMIT = 'c9e257663b2da005cf4f9a2477e80a9f108e4e26';
const LEVELS = [5, 4, 3, 2, 1];

const cacheDir = new URL('../.cache/jlpt/', import.meta.url);
const output = new URL('../public/jlpt.json', import.meta.url);

await mkdir(cacheDir, { recursive: true });
const levels = {};
for (const level of LEVELS) {
  const file = new URL(`n${level}.json`, cacheDir);
  if (!(await stat(file).then(() => true, () => false))) {
    const url = `https://raw.githubusercontent.com/wkei/jlpt-vocab-api/${COMMIT}/data-source/db/n${level}.json`;
    console.log('downloading', url);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`download failed: ${response.status}`);
    await writeFile(file, await response.text());
  }
  for (const entry of JSON.parse(await readFile(file, 'utf8'))) {
    const word = entry.word.trim();
    const reading = (entry.furigana ?? '').trim();
    for (const key of reading ? [`${word}|${reading}`, word] : [word]) {
      levels[key] ??= level;
    }
  }
}
await writeFile(output, JSON.stringify({ source: 'tanos.co.uk JLPT lists (CC BY)', levels }));
console.log(`wrote ${output.pathname}: ${Object.keys(levels).length} keys, ${((await stat(output)).size / 1e6).toFixed(2)} MB`);
