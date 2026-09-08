// Download and extraction helpers shared by the data build scripts.
import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const JMDICT_SIMPLIFIED_VERSION = '3.6.2+20260907165411';
export const cacheDir = new URL('../.cache/', import.meta.url);

export const exists = (url) => stat(url).then(() => true, () => false);

/** Downloads url to file unless the file already exists. */
export async function download(url, file, headers = {}) {
  if (await exists(file)) return;
  await mkdir(new URL('./', file), { recursive: true });
  console.log('downloading', url);
  const response = await fetch(url, { headers });
  if (!response.ok || !response.body) throw new Error(`download failed: ${response.status} ${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(file));
}

/** Returns the parsed JSON of a jmdict-simplified release file such as "jmdict-eng" or "kanjidic2-en". */
export async function loadJmdictSimplified(name) {
  const dir = new URL('jmdict/', cacheDir);
  const version = JMDICT_SIMPLIFIED_VERSION;
  const archive = new URL(`${name}-${version}.json.tgz`, dir);
  const url = `https://github.com/scriptin/jmdict-simplified/releases/download/${encodeURIComponent(version)}/${name}-${encodeURIComponent(version)}.json.tgz`;
  await download(url, archive);
  execFileSync('tar', ['-xzf', archive.pathname, '-C', dir.pathname]);
  const jsonName = (await readdir(dir)).find((file) => file.startsWith(`${name}-`) && file.endsWith('.json'));
  if (!jsonName) throw new Error(`extracted ${name} JSON not found`);
  return JSON.parse(await readFile(new URL(jsonName, dir), 'utf8'));
}
