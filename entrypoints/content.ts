import { katakanaToHiragana } from '@/utils/kana';
import type { KanjiExample, LookupResult, Message, PageState, Span, TokenizeResponse } from '@/utils/messages';
import type { PosGroup } from '@/utils/pos';
import { autoHighlight } from '@/utils/settings';

const JAPANESE = /[぀-ヿ㐀-䶿一-鿿]/;
const KATAKANA_WORD = /^[ァ-ヺヽ-ヿー\uFF66-\uFF9F]+$/;
const SKIPPED_PARENTS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'CODE', 'PRE']);
const BATCH_SIZE = 200;
const SETTLE_MS = 250;
const HOVER_DELAY_MS = 120;

const STYLES = `
.yomii {
  padding: 0.06em 0.08em !important;
  margin: 0 0.06em !important;
  border-radius: 0.3em !important;
  box-decoration-break: clone !important;
  -webkit-box-decoration-break: clone !important;
}
.yomii-noun { background-image: linear-gradient(90deg, rgba(255, 238, 140, 0.38), rgba(255, 214, 120, 0.3)) !important; }
.yomii-verb { background-image: linear-gradient(90deg, rgba(150, 200, 255, 0.38), rgba(140, 228, 235, 0.33)) !important; }
.yomii-adjective { background-image: linear-gradient(90deg, rgba(235, 170, 235, 0.36), rgba(195, 170, 255, 0.33)) !important; }
.yomii-adverb { background-image: linear-gradient(90deg, rgba(170, 230, 170, 0.38), rgba(210, 240, 150, 0.33)) !important; }
.yomii-katakana { background-image: linear-gradient(90deg, rgba(255, 168, 130, 0.4), rgba(255, 140, 125, 0.33)) !important; }
.yomii-dark.yomii-noun { background-image: linear-gradient(90deg, rgba(255, 238, 140, 0.17), rgba(255, 214, 120, 0.13)) !important; }
.yomii-dark.yomii-verb { background-image: linear-gradient(90deg, rgba(150, 200, 255, 0.17), rgba(140, 228, 235, 0.15)) !important; }
.yomii-dark.yomii-adjective { background-image: linear-gradient(90deg, rgba(235, 170, 235, 0.16), rgba(195, 170, 255, 0.15)) !important; }
.yomii-dark.yomii-adverb { background-image: linear-gradient(90deg, rgba(170, 230, 170, 0.17), rgba(210, 240, 150, 0.15)) !important; }
.yomii-dark.yomii-katakana { background-image: linear-gradient(90deg, rgba(255, 168, 130, 0.24), rgba(255, 140, 125, 0.2)) !important; }
.yomii-particle, .yomii-auxiliary { padding: 0 !important; margin: 0 !important; color: rgb(150, 150, 150) !important; }
`;

/** A text node that was replaced by wrapped tokens, kept so the page can be restored exactly. */
interface Replacement {
  original: Text;
  inserted: ChildNode[];
}

interface TokenInfo {
  surface: string;
  group: PosGroup;
  dictionaryForm: string;
  reading: string;
  normalizedForm: string;
}

/** Token details for every wrapped word, used by the hover card. */
const tokens = new WeakMap<Element, TokenInfo>();

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  async main() {
    const style = document.createElement('style');
    style.textContent = STYLES;
    document.documentElement.appendChild(style);

    const highlighter = new Highlighter();
    browser.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
      if (message.type === 'get-state') {
        sendResponse({ enabled: highlighter.enabled } satisfies PageState);
      } else if (message.type === 'set-enabled') {
        message.enabled ? highlighter.enable() : highlighter.disable();
        sendResponse({ enabled: highlighter.enabled } satisfies PageState);
      }
    });
    autoHighlight.watch((enabled) => (enabled ? highlighter.enable() : highlighter.disable()));

    const card = new HoverCard();
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    document.addEventListener('mouseover', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      if (target && card.contains(target)) return;
      const span = target?.closest('span.yomii');
      const info = span && tokens.get(span);
      if (span && info) showTimer = setTimeout(() => card.show(span, info), HOVER_DELAY_MS);
      else hideTimer = setTimeout(() => card.hide(), HOVER_DELAY_MS);
    });
    document.addEventListener('scroll', () => card.hide(), true);
    window.addEventListener('blur', () => card.hide());

    if (await autoHighlight.getValue()) highlighter.enable();
  },
});

/**
 * Wraps Japanese words in styled spans and keeps doing so as the page changes.
 * Pages that render client-side replace their DOM after load, so a single pass is not enough.
 */
class Highlighter {
  private active = false;
  private run = 0;
  private replacements: Replacement[] = [];
  private processed = new WeakSet<Node>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly observer = new MutationObserver((records) => {
    if (records.some((record) => record.addedNodes.length > 0 || record.type === 'characterData')) {
      this.schedule();
    }
  });

  get enabled(): boolean {
    return this.active;
  }

  enable() {
    if (this.active) return;
    this.active = true;
    this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    this.schedule();
  }

  disable() {
    if (!this.active) return;
    this.active = false;
    this.run++;
    clearTimeout(this.timer);
    this.observer.disconnect();
    for (const { original, inserted } of this.replacements) {
      const [first, ...rest] = inserted;
      if (first?.isConnected) first.replaceWith(original);
      for (const node of rest) node.remove();
    }
    this.replacements = [];
    this.processed = new WeakSet();
  }

  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.apply(), SETTLE_MS);
  }

  private async apply() {
    const thisRun = ++this.run;
    const nodes = this.pendingTextNodes();
    const backgrounds = new Map<Element, boolean>();
    for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
      const batch = nodes.slice(i, i + BATCH_SIZE);
      const message: Message = { type: 'tokenize', texts: batch.map((node) => node.data) };
      const spans: TokenizeResponse | null = await browser.runtime.sendMessage(message);
      if (thisRun !== this.run || !spans) return;
      const onDark = batch.map((node) => node.parentElement !== null && isDarkBackground(node.parentElement, backgrounds));
      batch.forEach((node, j) => {
        const nodeSpans = spans[j] ?? [];
        if (!node.isConnected || node.data !== message.texts[j]) return;
        this.processed.add(node);
        if (nodeSpans.length > 0) this.replacements.push(this.wrap(node, nodeSpans, onDark[j] ?? false));
      });
      this.observer.takeRecords();
    }
  }

  private pendingTextNodes(): Text[] {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, (node) => {
      const parent = node.parentElement;
      if (!parent || SKIPPED_PARENTS.has(parent.tagName) || parent.isContentEditable || parent.classList.contains('yomii')) {
        return NodeFilter.FILTER_REJECT;
      }
      if (this.processed.has(node) || !JAPANESE.test((node as Text).data)) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    return nodes;
  }

  private wrap(node: Text, spans: Span[], onDark: boolean): Replacement {
    const text = node.data;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const [start, end, group, dictionaryForm, reading, normalizedForm] of spans) {
      if (start > cursor) fragment.append(text.slice(cursor, start));
      const word = text.slice(start, end);
      const span = document.createElement('span');
      const classes = ['yomii', `yomii-${group}`];
      if (KATAKANA_WORD.test(word)) classes.push('yomii-katakana');
      if (onDark) classes.push('yomii-dark');
      span.className = classes.join(' ');
      span.textContent = word;
      tokens.set(span, { surface: word, group, dictionaryForm, reading, normalizedForm });
      fragment.append(span);
      cursor = end;
    }
    if (cursor < text.length) fragment.append(text.slice(cursor));
    const inserted = [...fragment.childNodes];
    for (const child of inserted) this.processed.add(child);
    node.replaceWith(fragment);
    return { original: node, inserted };
  }
}

const RGB = /^rgba?\((\d+(?:\.\d+)?), (\d+(?:\.\d+)?), (\d+(?:\.\d+)?)(?:, (\d+(?:\.\d+)?))?\)$/;

/** Walks up from the element to the first opaque background and reports whether it is dark. */
function isDarkBackground(element: Element, cache: Map<Element, boolean>): boolean {
  const cached = cache.get(element);
  if (cached !== undefined) return cached;
  let dark = false;
  const match = RGB.exec(getComputedStyle(element).backgroundColor);
  const alpha = match ? Number(match[4] ?? 1) : 0;
  if (match && alpha >= 0.5) {
    const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
    dark = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
  } else if (element.parentElement) {
    dark = isDarkBackground(element.parentElement, cache);
  }
  cache.set(element, dark);
  return dark;
}

const CARD_STYLES = `
:host { all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647; display: block; }
:host([hidden]) { display: none; }
.card {
  box-sizing: border-box;
  min-width: 180px;
  max-width: 400px;
  padding: 12px 14px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 12px;
  background: #fff;
  color: #1f2328;
  font: 14px/1.45 -apple-system, system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
}
.card.dark {
  border-color: rgba(255, 255, 255, 0.12);
  background: #26292e;
  color: #e6e6e6;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 10px; }
.word { font-size: 20px; font-weight: 600; }
.reading { opacity: 0.7; }
.badges { display: flex; gap: 6px; margin-left: auto; }
.badge { padding: 1px 7px; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 0.02em; }
.badge.jlpt { background: rgba(59, 130, 246, 0.15); color: #2563eb; }
.dark .badge.jlpt { background: rgba(96, 165, 250, 0.2); color: #93c5fd; }
.badge.common { background: rgba(34, 197, 94, 0.15); color: #15803d; }
.dark .badge.common { background: rgba(74, 222, 128, 0.2); color: #86efac; }
.badge.uncommon { background: rgba(0, 0, 0, 0.06); opacity: 0.7; }
.dark .badge.uncommon { background: rgba(255, 255, 255, 0.1); }
ol { margin: 8px 0 0; padding-left: 1.4em; }
li { margin: 4px 0; }
.pos { display: block; font-size: 12px; opacity: 0.6; }
.none { margin-top: 6px; font-size: 12px; opacity: 0.6; }
.kanji { margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(0, 0, 0, 0.1); display: flex; flex-direction: column; gap: 6px; }
.dark .kanji { border-top-color: rgba(255, 255, 255, 0.12); }
.kanji-row { display: flex; align-items: flex-start; gap: 10px; }
.kanji-char { font-size: 22px; line-height: 1.2; font-weight: 500; min-width: 1.2em; }
.kanji-details { flex: 1; min-width: 0; }
.kanji-meanings { font-size: 12px; opacity: 0.6; }
.kanji-readings { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 10px; margin-top: 3px; font-size: 13px; }
.kanji-readings .kun { opacity: 0.8; }
.example { display: flex; align-items: baseline; gap: 6px; min-width: 0; white-space: nowrap; }
.example-kana { font-size: 12px; opacity: 0.7; }
.example-gloss { font-size: 12px; opacity: 0.7; overflow: hidden; text-overflow: ellipsis; }
.example .badge { flex: none; padding: 0 6px; font-size: 10px; }
`;

/** Floating card with reading and meanings, shown while the mouse rests on a wrapped word. */
class HoverCard {
  private readonly host = document.createElement('yomii-card');
  private readonly card = document.createElement('div');
  private readonly lookups = new Map<string, Promise<LookupResult | null>>();
  private current: Element | undefined;

  constructor() {
    const root = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CARD_STYLES;
    this.card.className = 'card';
    root.append(style, this.card);
    this.host.hidden = true;
    document.documentElement.appendChild(this.host);
  }

  contains(element: Element): boolean {
    return element === this.host || this.host.contains(element);
  }

  async show(span: Element, info: TokenInfo) {
    this.current = span;
    const result = await this.lookup(info);
    if (this.current !== span || !span.isConnected) return;
    this.render(info, result);
    this.card.classList.toggle('dark', span.classList.contains('yomii-dark'));
    this.host.hidden = false;
    this.position(span.getBoundingClientRect());
  }

  hide() {
    this.current = undefined;
    this.host.hidden = true;
  }

  private lookup(info: TokenInfo): Promise<LookupResult | null> {
    const key = `${info.surface}|${info.dictionaryForm}|${info.normalizedForm}|${info.reading}|${info.group}`;
    let pending = this.lookups.get(key);
    if (!pending) {
      const message: Message = {
        type: 'lookup',
        surface: info.surface,
        dictionaryForm: info.dictionaryForm,
        normalizedForm: info.normalizedForm,
        reading: katakanaToHiragana(info.reading),
        group: info.group,
      };
      pending = browser.runtime.sendMessage(message).then((result: LookupResult | null) => result ?? null);
      this.lookups.set(key, pending);
    }
    return pending;
  }

  private render(info: TokenInfo, result: LookupResult | null) {
    const entry = result?.entry ?? null;
    const headword = entry?.headword ?? info.dictionaryForm;
    const reading = entry?.reading ?? katakanaToHiragana(info.reading);
    this.card.replaceChildren();

    const head = document.createElement('div');
    head.className = 'head';
    const word = document.createElement('span');
    word.className = 'word';
    word.textContent = headword;
    head.append(word);
    if (reading && reading !== headword) {
      const readingEl = document.createElement('span');
      readingEl.className = 'reading';
      readingEl.textContent = reading;
      head.append(readingEl);
    }
    const badges = document.createElement('span');
    badges.className = 'badges';
    if (result?.jlpt) badges.append(this.badge('jlpt', `N${result.jlpt}`));
    if (entry) badges.append(this.badge(entry.common ? 'common' : 'uncommon', entry.common ? 'common' : 'uncommon'));
    if (badges.childElementCount > 0) head.append(badges);
    this.card.append(head);

    if (entry) {
      const list = document.createElement('ol');
      for (const sense of entry.senses) {
        const item = document.createElement('li');
        item.textContent = sense.glosses.join('; ');
        const labels = [...sense.partOfSpeech.slice(0, 2), ...sense.misc.slice(0, 1)];
        if (labels.length > 0) {
          const pos = document.createElement('span');
          pos.className = 'pos';
          pos.textContent = labels.join(', ');
          item.append(pos);
        }
        list.append(item);
      }
      this.card.append(list);
    } else {
      const none = document.createElement('div');
      none.className = 'none';
      none.textContent = 'No dictionary entry';
      this.card.append(none);
    }

    if (result && result.kanji.length > 0) {
      const section = document.createElement('div');
      section.className = 'kanji';
      for (const kanji of result.kanji) {
        const row = document.createElement('div');
        row.className = 'kanji-row';
        const char = document.createElement('span');
        char.className = 'kanji-char';
        char.textContent = kanji.literal;
        const details = document.createElement('div');
        details.className = 'kanji-details';
        const meanings = document.createElement('div');
        meanings.className = 'kanji-meanings';
        meanings.textContent = kanji.meanings.join(', ');
        const readings = document.createElement('div');
        readings.className = 'kanji-readings';
        for (const [kind, list] of [['on', kanji.on], ['kun', kanji.kun]] as const) {
          for (const { reading, example } of list) {
            const label = document.createElement('span');
            label.className = kind;
            label.textContent = reading;
            readings.append(label, this.example(example));
          }
        }
        details.append(meanings, readings);
        row.append(char, details);
        section.append(row);
      }
      this.card.append(section);
    }
  }

  private example(example: KanjiExample | null): HTMLSpanElement {
    const container = document.createElement('span');
    container.className = 'example';
    if (!example) return container;
    const word = document.createElement('span');
    word.className = 'example-word';
    word.textContent = example.word;
    const kana = document.createElement('span');
    kana.className = 'example-kana';
    kana.textContent = example.reading;
    const gloss = document.createElement('span');
    gloss.className = 'example-gloss';
    gloss.textContent = example.gloss;
    container.append(word, kana, gloss);
    if (example.common) container.append(this.badge('common', 'common'));
    return container;
  }

  private badge(kind: string, text: string): HTMLSpanElement {
    const badge = document.createElement('span');
    badge.className = `badge ${kind}`;
    badge.textContent = text;
    return badge;
  }

  private position(anchor: DOMRect) {
    const margin = 8;
    const { width, height } = this.host.getBoundingClientRect();
    let top = anchor.bottom + margin;
    if (top + height > window.innerHeight - margin) top = Math.max(margin, anchor.top - height - margin);
    const left = Math.min(Math.max(margin, anchor.left), Math.max(margin, window.innerWidth - width - margin));
    this.host.style.top = `${top}px`;
    this.host.style.left = `${left}px`;
  }
}
