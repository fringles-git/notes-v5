import { CONFIG, DAY } from './config';

/* ---------- Text & numbers ---------- */
export const plural = (n: number, one: string, many: string) => n + ' ' + (n > 1 ? many : one);
export const fileSafe = (s: string) => s.replace(/[^\wÀ-ÿ -]/g, '').trim() || 'notes';
export const bytes = (n: number) => (n < 1e6 ? Math.max(1, Math.round(n / 1e3)) + ' ko' : (n / 1e6).toFixed(1).replace('.', ',') + ' Mo');
export const clock = (s: number) => Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
export const rate = (r: number) => String(r).replace('.', ',') + '×';
export const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

/* ---------- Dates (fr-FR, formatters cached) ---------- */
const formatters: Record<string, Intl.DateTimeFormat> = {};
export const fmt = (key: string, o: Intl.DateTimeFormatOptions) => (formatters[key] ||= new Intl.DateTimeFormat('fr-FR', o));
export const isToday = (t: number | Date) => new Date(t).toDateString() === new Date().toDateString();
export const day = (t: number | Date) => fmt('day', { day: 'numeric', month: 'short' }).format(t);
export const time = (t: number | Date) => fmt('time', { hour: '2-digit', minute: '2-digit' }).format(t);
export const dayOrTime = (t: number) => (isToday(t) ? time(t) : day(t));
export const dayTime = (t: number) => day(t) + ' ' + time(t);
export const eventDate = (d: Date, withTime: boolean) =>
  (d.getFullYear() !== new Date().getFullYear()
    ? fmt('event-year', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : fmt('event', { weekday: 'short', day: 'numeric', month: 'short' })
  ).format(d) + (withTime ? ' ' + time(d) : '');
export const daysAgo = (t: number) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((+today - new Date(t).setHours(0, 0, 0, 0)) / DAY);
};
export const relativeDay = (t: number) => {
  const n = daysAgo(t);
  if (n <= 0) return 'Aujourd’hui · ' + time(t);
  if (n === 1) return 'Hier · ' + time(t);
  return new Date(t).getFullYear() === new Date().getFullYear()
    ? day(t)
    : fmt('day-year', { day: 'numeric', month: 'short', year: 'numeric' }).format(t);
};
export const fullDay = (t: number) => capitalize(fmt('fullday', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(t));

/* ---------- DOM ---------- */
export const haptic = (kind: 'selectionStart' | 'confirm' | 'open' | 'threshold') =>
  navigator.vibrate?.({ selectionStart: 40, confirm: 20, open: 15, threshold: 10 }[kind]);
export const cssPx = (name: string) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
export const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
export const finePointer = () => matchMedia('(pointer:fine)').matches;
/** The shortcut modifier as printed on this keyboard. */
export const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
export const reducedMotion = () => matchMedia('(prefers-reduced-motion:reduce)').matches;
export const wide = () => matchMedia(CONFIG.wideMedia).matches;
export const openUrl = (url: string) => () => window.open(url, '_blank', 'noopener');
export const goUrl = (url: string) => () => { location.href = url; };

const scripts = new Map<string, Promise<unknown>>();
/** Loads a vendor script once and resolves with the global it defines. */
export function loadScript<T>(src: string, global: string): Promise<T> {
  if (!scripts.has(src))
    scripts.set(src, new Promise((resolve, reject) => {
      const el = Object.assign(document.createElement('script'), { src });
      el.onload = () => resolve((window as unknown as Record<string, unknown>)[global]);
      el.onerror = () => { scripts.delete(src); el.remove(); reject(Error(src + ' indisponible')); };
      document.head.appendChild(el);
    }));
  return scripts.get(src) as Promise<T>;
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Replaces [start, end) in a textarea through the browser's undo stack. */
export function replaceText(el: HTMLTextAreaElement, start: number, end: number, text: string) {
  el.focus();
  el.setSelectionRange(start, end);
  const ok = text ? document.execCommand('insertText', false, text) : start === end || document.execCommand('delete');
  if (!ok) {
    el.setRangeText(text, start, end, 'end');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/** Pixel offset of a character inside a textarea (for scrolling to it). */
export function caretTop(el: HTMLTextAreaElement, index: number) {
  const mirror = document.createElement('div'), mark = document.createElement('span'), cs = getComputedStyle(el);
  (['paddingTop', 'paddingRight', 'paddingLeft', 'fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'wordSpacing', 'tabSize'] as const)
    .forEach(k => { mirror.style[k] = cs[k]; });
  Object.assign(mirror.style, {
    position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', boxSizing: 'border-box',
    width: el.clientWidth + 'px', whiteSpace: 'pre-wrap', overflowWrap: 'break-word',
  });
  mirror.textContent = el.value.slice(0, index);
  mark.textContent = '​';
  mirror.append(mark);
  document.body.append(mirror);
  const top = mark.offsetTop;
  mirror.remove();
  return top;
}

export function focusAt(el: HTMLTextAreaElement, index: number, scroll = caretTop(el, index) - el.clientHeight / 3) {
  el.setSelectionRange(index, index);
  el.focus({ preventScroll: true });
  el.scrollTop = scroll;
}

export const shuffle = <T,>(list: T[]) => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Memoizes on argument identity — cheap selector cache for derived lists. */
export function memoArgs<A extends unknown[], R>(fn: (...a: A) => R) {
  let last: A | null = null, value: R;
  return (...a: A) => {
    if (!last || a.some((v, i) => v !== last![i])) { last = a; value = fn(...a); }
    return value;
  };
}
