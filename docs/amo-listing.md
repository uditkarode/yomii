# AMO listing text

Paste into the "Describe Add-on" form on addons.mozilla.org.

## Summary (250 characters max)

Colors the Japanese words on any page by part of speech so you can skim faster. Hover a word for its reading, meaning, JLPT level and each kanji's readings with an example word. Works offline, nothing leaves your browser.

## Description

Yomii highlights every Japanese word on a page with a soft color for its part of speech: nouns, verbs, adjectives, adverbs, and katakana words each get their own tint, while particles and auxiliaries are dimmed. Skimming gets faster because the structure of each sentence is visible at a glance.

Hover any highlighted word to see:

- its reading and dictionary meanings
- its JLPT level and whether it is a common word
- each kanji in the word with its official readings, and for every reading a well-known example word with its meaning

The popup turns automatic highlighting on or off, and can highlight or clear the current page once.

Everything runs inside Firefox. Words are split with the Sudachi tokenizer and looked up in bundled JMdict and KANJIDIC2 data. The extension makes no network requests and collects no data.

Dictionary data: JMdict and KANJIDIC2 are the property of the Electronic Dictionary Research and Development Group and are used in conformance with the Group's licence. SudachiDict by Works Applications (Apache 2.0), JmdictFurigana by Doublevil, JLPT lists by Jonathan Waller (tanos.co.uk, CC BY), jōyō readings from Wikipedia (CC BY-SA). Full notices ship inside the extension and are linked from the popup.

## Categories

Language Support

## Notes for reviewers

- The extension makes no network requests. Everything ships in the package: sudachi-dict.0 and sudachi-dict.1 (123 MB together) are the SudachiDict tokenizer dictionary system_small.dic split in two because of the 100 MiB per-file limit, and jmdict*.json, kanji.json and jlpt.json are generated from JMdict, KANJIDIC2 and the tanos JLPT lists by `npm run data` (see README.md in the source package). The generated files are included in the source package, so the build does not download anything.
- Build: `npm ci` then `npm run build:firefox`. The output directory `.output/firefox-mv3` matches the uploaded zip. Built with Node.js v22.22.2 and npm 10.9.7 on macOS 26.6 (arm64).
- `wasm-unsafe-eval` in the content security policy is required to run the Sudachi tokenizer, which is WebAssembly bundled into background.js.
- Data collection: none, declared in the manifest (`data_collection_permissions`).
