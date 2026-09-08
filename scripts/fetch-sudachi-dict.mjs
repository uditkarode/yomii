// Downloads the SudachiDict "small" edition and writes it to public/ in parts, because addons.mozilla.org rejects any
// file over 100 MiB inside an extension package. public/sudachi-dict.json lists the parts; the background script joins
// them again before handing the bytes to Sudachi.
import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const VERSION = '20260723';
const PART_SIZE = 64 * 1024 * 1024;

const cacheDir = new URL('../.cache/sudachi/', import.meta.url);
const archive = new URL(`sudachi-dictionary-${VERSION}-small.zip`, cacheDir);
const publicDir = new URL('../public/', import.meta.url);

await mkdir(cacheDir, { recursive: true });
await mkdir(publicDir, { recursive: true });
if (!(await stat(archive).then(() => true, () => false))) {
  const url = `http://sudachi.s3-website-ap-northeast-1.amazonaws.com/sudachidict/sudachi-dictionary-${VERSION}-small.zip`;
  console.log('downloading', url);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`download failed: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
}
execFileSync('unzip', ['-o', '-j', archive.pathname, `sudachi-dictionary-${VERSION}/system_small.dic`, '-d', cacheDir.pathname]);

const dictionary = await readFile(new URL('system_small.dic', cacheDir));
const parts = [];
for (let offset = 0; offset < dictionary.length; offset += PART_SIZE) {
  const name = `sudachi-dict.${parts.length}`;
  await writeFile(new URL(name, publicDir), dictionary.subarray(offset, offset + PART_SIZE));
  parts.push(name);
}
await writeFile(new URL('sudachi-dict.json', publicDir), JSON.stringify({ version: VERSION, size: dictionary.length, parts }));
console.log(`wrote ${parts.length} parts of system_small.dic (${(dictionary.length / 1e6).toFixed(1)} MB) to ${publicDir.pathname}`);
