# Yomii

Firefox and Chrome extension that colors the Japanese words on a page by part of speech so you can skim faster. Hovering a word shows a card with its reading, meaning, JLPT level, whether it is common, and each kanji's readings with a well-known example word for every reading.

Everything runs inside the browser: words are split with Sudachi (WebAssembly) and looked up in bundled JMdict and KANJIDIC2 data. The extension makes no network requests.

## Building

Requirements: Node.js 22 or newer and npm. The dictionary files in `public/` are part of the source package, so no download is needed to build.

```
npm ci
npm run build:firefox
```

`npm ci` also runs `wxt prepare` (postinstall), which generates the `.wxt/` directory. The Firefox build is written to `.output/firefox-mv3`; that directory is the content of the zip uploaded to addons.mozilla.org. `npm run build` writes the Chrome build to `.output/chrome-mv3`.

`npm run zip:firefox` writes the upload zip and the matching source zip to `.output/`.

The uploaded build was made on macOS 26.6 (arm64) with Node.js v22.22.2 and npm 10.9.7.

## Data files

`npm run data` downloads the dictionary sources into `.cache/` and writes the files the extension ships in `public/`:

| File | Script | Source |
|---|---|---|
| `system_small.dic` | `scripts/fetch-sudachi-dict.mjs` | SudachiDict small 20260723 |
| `jmdict.json` | `scripts/build-jmdict.mjs` | jmdict-simplified 3.6.2+20260907165411 (JMdict) |
| `jlpt.json` | `scripts/build-jlpt.mjs` | tanos.co.uk JLPT vocabulary lists |
| `kanji.json` | `scripts/build-kanji.mjs` | jmdict-simplified (KANJIDIC2), Wikipedia "List of jōyō kanji" revision 1351700992, JmdictFurigana 2.3.1+2026-08-25, JMdict XML frequency tags |

All sources are pinned except the JMdict XML (`JMdict_e.gz`), which EDRDG regenerates daily; only its frequency tags are read.

## Development

```
npm run dev:firefox   # builds, opens Firefox with the extension loaded, rebuilds on change
npm run dev           # same for Chromium
npm run typecheck
```

A `web-ext.config.ts` in the project root (ignored by git) can set `startUrls` for the development browser.

## Credits and licenses

Yomii bundles data from the projects below. The notices ship inside the extension as `NOTICE.txt` and `licenses/`, and the popup links to them.

- **JMdict and KANJIDIC2**: property of the Electronic Dictionary Research and Development Group (EDRDG), used in conformance with the [Group's licence](https://www.edrdg.org/edrdg/licence.html) (Creative Commons Attribution-ShareAlike 4.0). Loaded from the JSON releases of [jmdict-simplified](https://github.com/scriptin/jmdict-simplified) (CC BY-SA 4.0).
- **[JmdictFurigana](https://github.com/Doublevil/JmdictFurigana)** by Doublevil: kanji-to-reading alignment for JMdict words (CC BY-SA).
- **[SudachiDict](https://github.com/WorksApplications/SudachiDict)** by Works Applications Co., Ltd.: Apache License 2.0. Includes UniDic and a part of NEologd.
- **[sudachi-wasm333](https://github.com/Benjas333/sudachi-wasm333)** by Benjas333, a WebAssembly build of [sudachi.rs](https://github.com/WorksApplications/sudachi.rs) by Works Applications: Apache License 2.0.
- **[JLPT vocabulary lists](https://www.tanos.co.uk/jlpt/)** by Jonathan Waller: Creative Commons Attribution. JSON copies from [jlpt-vocab-api](https://github.com/wkei/jlpt-vocab-api).
- **Jōyō kanji readings** from Wikipedia's [List of jōyō kanji](https://en.wikipedia.org/w/index.php?title=List_of_j%C5%8Dy%C5%8D_kanji&oldid=1351700992) (CC BY-SA 4.0), transcribing the 2010 常用漢字表.
