/** Notes' light Markdown: line kinds, inline marks, checklists, links, tags, flashcards, detected entities. Pure functions. */
import type { Flashcard, Note } from './types';
import { CONFIG, DAY } from './config';

/* ---------- Checklists ---------- */
const CHECK = /^- \[( |x|X)\] (.*)$/;
const CHECK_PREFIX = /^- \[( |x|X)\] /;
export const UNCHECKED = '- [ ] ';

export function parseCheck(line: string) {
  const m = (line || '').match(CHECK);
  return m ? { done: m[1] !== ' ', text: m[2], prefix: line.length - m[2].length } : null;
}
const isDone = (line: string) => !!parseCheck(line)?.done;
export const stripCheck = (line: string) => line.replace(CHECK_PREFIX, '');

export function checkStats(body: string) {
  let done = 0, total = 0;
  for (const line of body.split('\n')) {
    const c = parseCheck(line);
    if (c) { total++; done += +c.done; }
  }
  return { done, total };
}

export function toggleCheck(body: string, index: number, on: boolean) {
  const lines = body.split('\n');
  if (!parseCheck(lines[index])) return null;
  lines[index] = lines[index].replace(CHECK_PREFIX, on ? '- [x] ' : UNCHECKED);
  return lines.join('\n');
}

/** Moves checked items to the end of each checklist block. */
export function sinkChecked(body: string) {
  const lines = body.split('\n'), out: string[] = [];
  for (let i = 0; i < lines.length;) {
    if (!parseCheck(lines[i])) { out.push(lines[i++]); continue; }
    const block: string[] = [];
    while (i < lines.length && parseCheck(lines[i])) block.push(lines[i++]);
    out.push(...block.filter(l => !isDone(l)), ...block.filter(isDone));
  }
  return out.join('\n');
}
export const uncheckAll = (body: string) => body.split('\n').map(l => (isDone(l) ? l.replace(CHECK_PREFIX, UNCHECKED) : l)).join('\n');
export const dropChecked = (body: string) => body.split('\n').filter(l => !isDone(l)).join('\n');
/** True when the body holds nothing but empty checklist items. */
export const isBlank = (body: string) => body.split('\n').every(l => !l.trim() || (parseCheck(l) && !parseCheck(l)!.text.trim()));

/* ---------- Line kinds ---------- */
export type LineKind = 'text' | 'h1' | 'h2' | 'h3' | 'bullet' | 'number' | 'check';
export interface Line { kind: LineKind; prefix: string; text: string; n: number }

const HEADING = /^(#{1,3}) /, NUMBER = /^(\d{1,3})[.)] /, BULLET = /^[-*•] /;
export function parseLine(line: string): Line {
  const c = parseCheck(line), h = line.match(HEADING), n = line.match(NUMBER), b = line.match(BULLET);
  const make = (kind: LineKind, prefix: string, num = 0) => ({ kind, prefix, text: line.slice(prefix.length), n: num });
  if (c) return make('check', line.slice(0, c.prefix));
  if (h) return make(('h' + h[1].length) as LineKind, h[0]);
  if (n) return make('number', n[0], +n[1]);
  if (b) return make('bullet', b[0]);
  return make('text', '');
}
export const headingLevel = (k: LineKind) => (k[0] === 'h' ? +k[1] : 0);

export const outline = (body: string) =>
  body.split('\n').flatMap((line, i) => {
    const p = parseLine(line), level = headingLevel(p.kind);
    return level && p.text.trim() ? [{ level, text: p.text.trim(), line: i }] : [];
  });

/* ---------- Inline marks ---------- */
export type Mark = 'b' | 'i' | 'hl' | 'link';
export const MARKS: Record<Mark, [string, string]> = { b: ['**', '**'], i: ['*', '*'], hl: ['==', '=='], link: ['[[', ']]'] };
const WIKI = /\[\[([^\]\n]{1,80})\]\]/g;
const MARK_ORDER: Mark[] = ['b', 'hl', 'link', 'i'];
const INLINE = RegExp('\\*\\*([^*\\n]+)\\*\\*|==([^=\\n]+)==|' + WIKI.source + '|\\*([^*\\s][^*\\n]*)\\*', 'g');

export interface Leaf { text: string; at: number; marks: Mark[] }
export interface Span { mark: Mark; start: number; end: number }

/** Splits text into styled leaves (with source offsets) and the spans of each mark. */
export function parseInline(text: string, offset = 0) {
  const leaves: Leaf[] = [], spans: Span[] = [];
  (function walk(s: string, base: number, marks: Mark[]) {
    let last = 0;
    for (const m of s.matchAll(INLINE)) {
      const g = m.slice(1).findIndex(v => v !== undefined), mark = MARK_ORDER[g], inner = m[g + 1], at = m.index!;
      if (at > last) leaves.push({ text: s.slice(last, at), at: base + last, marks });
      const start = base + at + MARKS[mark][0].length;
      spans.push({ mark, start, end: start + inner.length });
      if (mark === 'link') leaves.push({ text: inner, at: start, marks: [...marks, mark] });
      else walk(inner, start, [...marks, mark]);
      last = at + m[0].length;
    }
    if (last < s.length) leaves.push({ text: s.slice(last), at: base + last, marks });
  })(text, offset, []);
  return { leaves, spans };
}

/** The span of `mark` covering [start, end) in a line, if any. */
export function markAt(line: string, start: number, end: number, mark: Mark, includeDelims = true) {
  const p = parseLine(line), [open, close] = MARKS[mark], k = +includeDelims;
  return parseInline(p.text, p.prefix.length).spans.find(
    s => s.mark === mark && s.start - k * open.length <= start && end <= s.end + k * close.length,
  );
}

/** Text without Markdown syntax (bullets kept as •). */
export const plainLine = (line: string) => {
  const p = parseLine(line);
  return (p.kind === 'bullet' ? '• ' : p.kind === 'number' ? p.n + '. ' : '') + parseInline(p.text).leaves.map(l => l.text).join('');
};
export const plainText = (body: string) => body.split('\n').map(plainLine).join('\n');
export const wordCount = (body: string) => {
  const t = plainText(body).trim();
  return t ? t.split(/\s+/).length : 0;
};

/* ---------- Editing operations on a textarea value ---------- */
export const lineStart = (s: string, i: number) => s.lastIndexOf('\n', i - 1) + 1;
export const lineEnd = (s: string, i: number) => {
  const n = s.indexOf('\n', i);
  return n < 0 ? s.length : n;
};
export interface Edit { value: string; start: number; end: number }
const KIND_PREFIX: Record<string, string> = { text: '', h1: '# ', h2: '## ', h3: '### ', bullet: '- ', check: UNCHECKED };
export const NEXT_HEADING: Record<string, LineKind> = { h1: 'h2', h2: 'h3', h3: 'text' };

/** Sets (or toggles off) a line kind on every line of the selection. */
export function setLineKind(value: string, start: number, end: number, kind: LineKind): Edit {
  const from = lineStart(value, start), to = lineEnd(value, end);
  const lines = value.slice(from, to).split('\n').map(parseLine);
  const skip = (l: Line) => lines.length > 1 && !l.prefix && !l.text;
  const target = lines.filter(l => !skip(l)).every(l => l.kind === kind) ? 'text' : kind;
  const prev = from ? parseLine(value.slice(lineStart(value, from - 1), from - 1)) : null;
  let n = prev?.kind === 'number' ? prev.n + 1 : 1;
  const out = lines.map(l => (skip(l) ? '' : (target === 'number' ? n++ + '. ' : KIND_PREFIX[target]) + l.text));
  const joined = out.join('\n'), next = value.slice(0, from) + joined + value.slice(to);
  if (lines.length > 1) return { value: next, start: from, end: from + joined.length };
  const map = (i: number) => from + out[0].length - lines[0].text.length + Math.max(0, i - from - lines[0].prefix.length);
  return { value: next, start: map(start), end: map(end) };
}

const WORD = /[\p{L}\p{N}'’_-]/u;
type LineEdit = { text: string; map: (i: number) => number };
const same = (text: string): LineEdit => ({ text, map: i => i });

function unwrap(line: string, span: Span, mark: Mark): LineEdit {
  const [open, close] = MARKS[mark], a = span.start - open.length, b = span.end;
  return {
    text: line.slice(0, a) + line.slice(span.start, b) + line.slice(b + close.length),
    map: i => (i <= a ? i : i <= span.start ? a : i <= b ? i - open.length : i <= b + close.length ? b - open.length : i - open.length - close.length),
  };
}
function wrap(line: string, start: number, end: number, mark: Mark): LineEdit {
  const [open, close] = MARKS[mark], min = parseLine(line).prefix.length;
  let a = Math.max(start, min), b = Math.max(end, a);
  if (a === b) {
    while (a > min && WORD.test(line[a - 1])) a--;
    while (b < line.length && WORD.test(line[b])) b++;
    if (!(a < start && start < b)) {
      a = b = Math.max(start, min);
      return { text: line.slice(0, a) + open + close + line.slice(a), map: i => (i < a ? i : i + open.length + (i > a ? close.length : 0)) };
    }
  }
  while (a < b && /\s/.test(line[a])) a++;
  while (b > a && /\s/.test(line[b - 1])) b--;
  if (a === b) return same(line);
  return {
    text: line.slice(0, a) + open + line.slice(a, b) + close + line.slice(b),
    map: i => (i < a ? i : i <= b ? i + open.length : i + open.length + close.length),
  };
}

/** Toggles an inline mark over the selection, line by line. */
export function toggleMark(value: string, start: number, end: number, mark: Mark): Edit {
  const from = lineStart(value, start), to = lineEnd(value, end), raw = value.slice(from, to).split('\n');
  let at = from;
  const lines = raw.map((line, i) => {
    const o = { line, ls: i ? 0 : start - at, le: i < raw.length - 1 ? line.length : end - at };
    at += line.length + 1;
    return o;
  });
  const active = lines.filter(l => l.line.trim() || raw.length === 1);
  const spans = active.map(l => markAt(l.line, l.ls, l.le, mark));
  const remove = spans.every(Boolean);
  let pos = from, s = start, e = end;
  const out = lines.map((l, i) => {
    const k = active.indexOf(l);
    const edit = k < 0 ? same(l.line) : remove ? unwrap(l.line, spans[k]!, mark) : spans[k] ? same(l.line) : wrap(l.line, l.ls, l.le, mark);
    if (!i) s = pos + edit.map(l.ls);
    if (i === lines.length - 1) e = pos + edit.map(l.le);
    pos += edit.text.length + 1;
    return edit.text;
  });
  return { value: value.slice(0, from) + out.join('\n') + value.slice(to), start: s, end: e };
}

/** Turns the caret line into a flashcard "Question :: " (caret after ::), or back into plain text. */
export function toggleCard(value: string, start: number, end: number): Edit {
  const from = lineStart(value, start), to = lineEnd(value, end), line = value.slice(from, to), at = line.indexOf(' :: ');
  if (at > -1) {
    const next = line.slice(0, at) + (line.slice(at + 4) ? ' ' + line.slice(at + 4) : '');
    return { value: value.slice(0, from) + next + value.slice(to), start: from + next.length, end: from + next.length };
  }
  const next = line.trimEnd() + ' :: ', pos = from + next.length;
  return { value: value.slice(0, from) + next + value.slice(to), start: pos, end: pos };
}

/** Formatting state at the caret: line kind and active marks. */
export function formatState(value: string, start: number, end: number) {
  const from = lineStart(value, start), line = value.slice(from, lineEnd(value, start));
  const a = start - from, b = Math.min(end - from, line.length);
  return { kind: parseLine(line).kind, marks: (Object.keys(MARKS) as Mark[]).filter(m => markAt(line, a, b, m, false)), card: line.includes(' :: ') };
}
export type FormatState = ReturnType<typeof formatState>;

/** Keeps an edit's untouched prefix/suffix so the browser undo stack stays small. */
export function minimalDiff(before: string, after: string) {
  let a = 0, z = 0;
  while (a < before.length && a < after.length && before[a] === after[a]) a++;
  while (z < before.length - a && z < after.length - a && before[before.length - 1 - z] === after[after.length - 1 - z]) z++;
  return { start: a, end: before.length - z, text: after.slice(a, after.length - z) };
}

/* ---------- Tags, links, flashcards ---------- */
export const TAG = /(^|[\s(])#(\p{L}[\p{L}\p{N}_-]{0,29})/gu;
const tagCache = new WeakMap<Note, string[]>();
export function tagsOf(n: Note) {
  let t = tagCache.get(n);
  if (!t) tagCache.set(n, (t = [...new Set([...(n.title + '\n' + n.body).matchAll(TAG)].map(m => m[2].toLowerCase()))]));
  return t;
}

export const titleIndex = (notes: Note[]) => {
  const map = new Map<string, Note>();
  notes.forEach(n => n.title.trim() && map.set(n.title.trim().toLowerCase(), n));
  return map;
};
export const backlinks = (note: Note, notes: Note[]) => {
  const t = note.title.trim().toLowerCase();
  return t ? notes.filter(n => n !== note && entities(n).links.some(l => l.toLowerCase() === t)) : [];
};

const CARD = /^(?:- (?:\[[ xX]\] )?)?(.+?)\s+::\s+(.+)$/;
export const flashcards = (body: string): Flashcard[] =>
  body.split('\n').flatMap((line, i) => {
    const m = line.match(CARD);
    return m ? [{ q: m[1].trim(), a: m[2].trim(), line: i, key: m[1].trim().toLowerCase() }] : [];
  });
export const dueCards = (n: Note, now = Date.now()) => {
  const p = n.cards || {};
  return flashcards(n.body).filter(c => !p[c.key] || p[c.key].due <= now);
};
export const nextDue = (notes: Note[]) => {
  const d = notes.flatMap(n => flashcards(n.body).map(c => n.cards?.[c.key]?.due || 0));
  return d.length ? Math.min(...d) : 0;
};
export const masteredCount = (notes: Note[]) =>
  notes.reduce((s, n) => s + flashcards(n.body).filter(c => (n.cards?.[c.key]?.box || 0) >= 3).length, 0);
export function grade(n: Note, card: Flashcard, knew: boolean) {
  const cards = { ...n.cards }, box = knew ? Math.min((cards[card.key]?.box || 0) + 1, CONFIG.studyBoxes.length - 1) : 0;
  cards[card.key] = { box, due: Date.now() + DAY * CONFIG.studyBoxes[box] };
  return cards;
}
export function removeCardLine(body: string, card: Flashcard) {
  const lines = body.split('\n'), line = lines[card.line];
  if (line === undefined || line.match(CARD)?.[1].trim().toLowerCase() !== card.key) return null;
  lines.splice(card.line, 1);
  return lines.join('\n');
}

/* ---------- Detected entities: dates, urls, emails, phones, addresses, [[links]] ---------- */
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['jan', 'fev', 'mar', 'avr', 'mai', 'juin', 'juil', 'aou', 'sep', 'oct', 'nov', 'dec'];
const AT_TIME = '(?:\\s*(?:à|,)?\\s*(\\d{1,2})\\s*[h:]\\s*(\\d{2})?)?';
export const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'\]]*[^\s<>"'.,;:!?)\]]/gi;
const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
const PHONE = /(?:\+33\s?|\b0)[1-9](?:[\s.-]?\d{2}){4}(?!\d)/g;
const ADDRESS = /\b\d{1,4}(?:\s?(?:bis|ter))?,?\s+(?:rue|avenue|av\.|boulevard|bd|place|chemin|allée|impasse|quai|route|cours)\s+[^\n,;.]{2,40}(?:,?\s+\d{5}\s+[A-Za-zÀ-ÿ'’ -]{2,30})?/gi;

function makeDate(d: number, m: number, y: string | undefined, ref: Date) {
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  const year = y ? (y.length === 2 ? 2000 + +y : +y) : ref.getFullYear(), date = new Date(year, m, d);
  if (date.getMonth() !== m) return null;
  if (!y && +date < +ref - 60 * DAY) date.setFullYear(year + 1);
  return date;
}
const DATE_RULES: { re: RegExp; timeAt: number; parse: (m: RegExpMatchArray, ref: Date) => Date | null | false }[] = [
  {
    re: RegExp('\\b(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{4}|\\d{2}))?(?![\\d\\/])' + AT_TIME, 'gi'), timeAt: 4,
    parse: (m, ref) => (!!m[3] || m[1].length === 2 || m[2].length === 2) && makeDate(+m[1], +m[2] - 1, m[3], ref),
  },
  {
    re: RegExp('\\b(1er|\\d{1,2})\\s+(janvier|janv|février|fevrier|févr|fevr|mars|avril|avr|mai|juin|juillet|juil|août|aout|septembre|sept|octobre|oct|novembre|nov|décembre|decembre|déc|dec)\\.?(?![a-zà-ÿ])(?:\\s+(\\d{4}))?' + AT_TIME, 'gi'),
    timeAt: 4,
    parse: (m, ref) => {
      const name = m[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      return makeDate(parseInt(m[1], 10), MONTHS.findIndex(x => name.startsWith(x)), m[3], ref);
    },
  },
  {
    re: RegExp('\\b(aujourd[’\']hui|après-demain|apres-demain|demain|' + WEEKDAYS.join('|') + ')(?:\\s+prochain)?(?!\\s+(?:le\\s+)?(?:1er|\\d{1,2})(?:\\s*\\/|\\s+[a-zé]{3}))' + AT_TIME, 'gi'),
    timeAt: 2,
    parse: (m, ref) => {
      const w = m[1].toLowerCase(), d = new Date(ref), wd = WEEKDAYS.indexOf(w);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + (wd > -1 ? (wd - d.getDay() + 7) % 7 : w.startsWith('demain') ? 1 : 2 * +(w.indexOf('demain') > 0)));
      return d;
    },
  },
];

export interface FoundDate { start: Date; hasTime: boolean }
const uniq = (l: string[], max = 3) => [...new Set(l.map(s => s.trim()))].slice(0, max);
const entityCache = new WeakMap<Note, ReturnType<typeof computeEntities>>();

function computeEntities(n: Note) {
  const text = n.title + '\n' + n.body, all = (re: RegExp) => [...text.matchAll(re)].map(m => m[1] || m[0]);
  const ref = new Date(n.created), dates = new Map<string, FoundDate>();
  for (const { re, parse, timeAt } of DATE_RULES)
    for (const m of text.matchAll(re)) {
      const d = parse(m, ref);
      if (!d) continue;
      const h = m[timeAt], min = m[timeAt + 1], hasTime = h != null && +h < 24 && (min == null || +min < 60);
      if (hasTime) d.setHours(+h, +(min || 0), 0, 0);
      dates.set(+d + ':' + hasTime, { start: d, hasTime });
    }
  return {
    dates: [...dates.values()].sort((a, b) => +a.start - +b.start).slice(0, 4),
    urls: uniq(all(URL_RE)), emails: uniq(all(EMAIL)), phones: uniq(all(PHONE)),
    addresses: uniq(all(ADDRESS), 2), links: uniq(all(WIKI), 8),
  };
}
export function entities(n: Note) {
  let e = entityCache.get(n);
  if (!e) entityCache.set(n, (e = computeEntities(n)));
  return e;
}
export const withScheme = (u: string) => (/^https?:/i.test(u) ? u : 'https://' + u);
export const hostOf = (u: string) => {
  try { return new URL(withScheme(u)).hostname.replace(/^www\./, ''); } catch { return u; }
};

/** A short excerpt around a match, for search results. */
export function snippet(text: string, at: number, len: number) {
  let a = Math.max(0, at - 40), b = Math.min(text.length, at + len + 120);
  if (a > 0) a = text.indexOf(' ', a) + 1 || a;
  if (b < text.length) b = text.lastIndexOf(' ', b) > at + len ? text.lastIndexOf(' ', b) : b;
  return (a > 0 ? '…' : '') + text.slice(a, b).trim().replace(/\s*\n\s*/g, ' · ') + (b < text.length ? '…' : '');
}

/** What a note offers beyond its text: outline, flashcards, links, checked items. */
export function noteTools(n: Note, notes: Note[]) {
  const cards = flashcards(n.body).length;
  return {
    heads: outline(n.body).length, cards, due: cards ? dueCards(n).length : 0, done: checkStats(n.body).done,
    linked: entities(n).links.length > 0 || backlinks(n, notes).length > 0,
  };
}
