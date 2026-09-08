// Downloads the SudachiDict "small" edition and places system_small.dic in public/.
import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const VERSION = '20260723';

const cacheDir = new URL('../.cache/sudachi/', import.meta.url);
const archive = new URL(`sudachi-dictionary-${VERSION}-small.zip`, cacheDir);
const publicDir = new URL('../public/', import.meta.url);

await mkdir(cacheDir, { recursive: true });
if (!(await stat(archive).then(() => true, () => false))) {
  const url = `http://sudachi.s3-website-ap-northeast-1.amazonaws.com/sudachidict/sudachi-dictionary-${VERSION}-small.zip`;
  console.log('downloading', url);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`download failed: ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
}
execFileSync('unzip', ['-o', '-j', archive.pathname, `sudachi-dictionary-${VERSION}/system_small.dic`, '-d', publicDir.pathname]);
console.log('wrote', new URL('system_small.dic', publicDir).pathname);
