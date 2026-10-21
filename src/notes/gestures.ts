/** Touch & keyboard: long-press select, swipe pin/trash, pinned reorder, pull-to-search, drag-to-close (note, sheets), shortcuts, paste. */
import { CONFIG, TOUR } from './config';
import { icons } from './ui/icons';
import { anchorFrom } from './ui/kit';
import { get, isGuiding, noteById, set } from './store';
import {
  closeEditor, closeLayer, closeSearch, closeSheet, createAndOpen, dailyNote, doSwipe, endSelecting, flushEditor, fromTemplate, goHome,
  openNoteMenu, openSearch, reorderPinned, startSelecting, swipeAction,
} from './actions';
import { answer, checkReminders, endWelcome, importShared, reveal, tourStep } from './features';
import { haptic, isTyping, wide } from './utils';

const CARD = '#note-list .card';
const press = { timer: 0, x: 0, y: 0, blockClick: false };
const swipe = { card: null as HTMLElement | null, active: false, armed: false, dir: 0, dx: 0, label: null as HTMLElement | null };
const drag = { card: null as HTMLElement | null, x: 0, y: 0, target: null as HTMLElement | null };
const pull = { y: null as number | null, dy: 0 };
const close = { y: null as number | null, dy: 0, active: false };
const sheet = { el: null as HTMLElement | null, y: 0, dy: 0 };
const editorEl = () => document.getElementById('editor');
const split = () => matchMedia(CONFIG.splitMedia).matches;

/** A tap that ended a long-press or swipe must not also open the card. */
export function consumeClick() {
  const blocked = press.blockClick;
  press.blockClick = false;
  return blocked;
}

const dropLabel = () => { swipe.label?.remove(); swipe.label = null; };

function onDown(e: PointerEvent) {
  const t = e.target as HTMLElement;
  if (t.closest('#format-bar button')) e.preventDefault();   // keep the textarea focused
  if (e.button !== 0) return;
  // A bottom sheet (phone) follows the finger down from its handle or head, and closes past a threshold
  const head = t.closest<HTMLElement>('.sheet[data-drag]:not([data-closing]) :is(.sheet-grabber, .sheet-head)');
  if (head && !t.closest('button, input') && !wide()) return void Object.assign(sheet, { el: head.closest('.sheet'), y: e.clientY, dy: 0 });
  const grip = t.closest<HTMLElement>('.card-grip');
  if (grip && get().selecting) {
    e.preventDefault();
    const card = grip.closest<HTMLElement>('.card')!;
    Object.assign(drag, { card, x: e.clientX, y: e.clientY, target: null });
    try { grip.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    card.classList.add('dragging');
    return;
  }
  if (get().editor.id !== null && !split()) {
    if (t.closest('.editor-grabber, .editor-head') && !t.closest('button, input')) Object.assign(close, { y: e.clientY, dy: 0, active: false });
    return;
  }
  press.blockClick = false;
  swipe.card = null;
  const card = t.closest<HTMLElement>(CARD);
  if (!card || get().selecting || t.closest('.check-hit, .wave-play, .card-more, .card-actions')) return;
  Object.assign(press, { x: e.clientX, y: e.clientY });
  press.timer = window.setTimeout(() => { press.blockClick = true; swipe.card = null; startSelecting(+card.dataset.id!); }, CONFIG.longPressMs);
  const nearEdge = e.pointerType === 'touch' && (e.clientX < 24 || e.clientX > innerWidth - 24);   // leave system back gestures alone
  if (!nearEdge) Object.assign(swipe, { card, active: false, armed: false, dir: 0, dx: 0 });
}

function moveSwipe(dx: number) {
  const card = swipe.card!, n = noteById(+card.dataset.id!), dir = Math.sign(dx), act = n && dir ? swipeAction(n, dir) : null;
  card.style.transform = `translateX(${act ? dx : dx * 0.15}px)`;
  if (!act) { dropLabel(); swipe.armed = false; return; }
  if (!swipe.label || swipe.dir !== dir) {
    dropLabel();
    swipe.dir = dir;
    const label = (swipe.label = document.createElement('span'));
    label.className = `swipe-action ${act.tone} ${dir > 0 ? 'from-left' : 'from-right'}`;
    label.innerHTML = `<span class="swipe-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${icons[act.icon]}</svg></span>`;
    label.append(act.label);
    card.appendChild(label);
  }
  const limit = Math.min(CONFIG.swipeMax, card.offsetWidth * 0.35), armed = Math.abs(dx) >= limit;
  if (armed && !swipe.armed) haptic('threshold');
  swipe.armed = armed;
  swipe.label.classList.toggle('armed', armed);
  swipe.label.style.opacity = String(Math.min(1, Math.abs(dx) / limit));
}

function onMove(e: PointerEvent) {
  if (sheet.el) {
    sheet.dy = Math.max(0, e.clientY - sheet.y);
    sheet.el.classList.add('dragging');
    sheet.el.style.translate = `0 ${sheet.dy}px`;
    return;
  }
  if (drag.card) {
    drag.card.style.transform = `translate(${e.clientX - drag.x}px, ${e.clientY - drag.y}px)`;
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(CARD + '[data-pinned]'), target = over && over !== drag.card ? over : null;
    if (target !== drag.target) {
      drag.target?.classList.remove('drop-target');
      if (target) { target.classList.add('drop-target'); haptic('threshold'); }
      drag.target = target;
    }
    return;
  }
  if (close.y !== null) {
    const dy = e.clientY - close.y;
    if (close.active || dy >= 10) {
      close.active = true;
      close.dy = Math.max(0, dy - 10);
      const ed = editorEl()!;
      ed.classList.add('dragging');
      ed.style.transform = `translateY(${close.dy}px)`;
    }
    return;
  }
  const dx = e.clientX - press.x, dy = e.clientY - press.y;
  if (Math.abs(dx) > 10 || Math.abs(dy) > 10) clearTimeout(press.timer);
  if (!swipe.card) return;
  if (!swipe.active) {
    if (Math.abs(dy) > CONFIG.swipeStart && Math.abs(dy) >= Math.abs(dx)) { swipe.card = null; return; }
    if (Math.abs(dx) < CONFIG.swipeStart || Math.abs(dx) <= 1.5 * Math.abs(dy)) return;
    swipe.active = true;
    try { swipe.card.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    swipe.card.classList.remove('swipe-release');
    swipe.card.classList.add('swiping');
  }
  swipe.dx = dx;
  moveSwipe(dx);
}

function onUp(commit: boolean) {
  clearTimeout(press.timer);
  if (sheet.el) {
    const el = sheet.el, done = commit && sheet.dy >= CONFIG.sheetDragClose;
    sheet.el = null;
    el.classList.remove('dragging');
    if (done) {
      haptic('confirm');
      if (el.classList.contains('welcome')) endWelcome(false); else closeSheet();
      return;
    }
    el.classList.add('drag-release');
    el.style.translate = '';
    setTimeout(() => el.classList.remove('drag-release'), 240);
    return;
  }
  if (drag.card) {
    const { card, target } = drag;
    Object.assign(drag, { card: null, target: null });
    card.classList.remove('dragging');
    card.style.transform = '';
    target?.classList.remove('drop-target');
    if (commit && target) reorderPinned(+card.dataset.id!, +target.dataset.id!);
  }
  if (close.y !== null) {
    const done = commit && close.dy >= CONFIG.editorDragClose, ed = editorEl()!;
    close.y = null;
    ed.classList.remove('dragging');
    ed.style.transform = '';
    if (done) { haptic('confirm'); closeEditor(); }
  }
  const { card, active, armed, dx } = swipe;
  swipe.card = null;
  if (!card || !active) return;
  press.blockClick = true;
  const n = noteById(+card.dataset.id!), act = commit && armed && n ? swipeAction(n, Math.sign(dx)) : null, label = swipe.label;
  swipe.label = null;
  card.classList.remove('swiping');
  card.classList.add('swipe-release');
  swipe.active = swipe.armed = false;
  if (act?.kind === 'trash') {
    card.style.transform = `translateX(${Math.sign(dx) * innerWidth}px)`;
    return void setTimeout(() => { label?.remove(); doSwipe(n!, 'trash'); }, 180);
  }
  card.style.transform = '';
  setTimeout(() => { label?.remove(); card.style.transform = ''; card.classList.remove('swipe-release'); }, 180);
  if (act) doSwipe(n!, act.kind);
}

/* Pull the list down from the top to open search (touch only; native overscroll is disabled in CSS). */
const listIdle = () => { const s = get(); return !s.searchOpen && !s.selecting && s.editor.id === null && !s.layer.mode && !s.sheet && !isGuiding(s); };
function onTouchStart(e: TouchEvent) {
  pull.y = scrollY <= 0 && listIdle() && (e.target as HTMLElement).closest('#note-list, .app-header') ? e.touches[0].clientY : null;
  pull.dy = 0;
}
function onTouchMove(e: TouchEvent) {
  if (pull.y === null) return;
  pull.dy = Math.max(0, e.touches[0].clientY - pull.y);
  if (swipe.active) { pull.y = null; pull.dy = 0; }
  const p = Math.min(1, pull.dy / CONFIG.pullToSearch);
  document.documentElement.style.setProperty('--pull', String(p));
  document.documentElement.classList.toggle('is-pulling', pull.dy > 4);
  if (p === 1 && !document.documentElement.classList.contains('pull-armed')) haptic('threshold');
  document.documentElement.classList.toggle('pull-armed', p === 1);
}
function onTouchEnd() {
  const go = pull.y !== null && pull.dy >= CONFIG.pullToSearch;
  pull.y = null;
  const root = document.documentElement;
  root.classList.remove('is-pulling', 'pull-armed');
  root.style.setProperty('--pull', '0');
  if (go) openSearch();
}

/** Right-click (or the menu key) opens the note's menu, as on a desktop; a long touch still starts selecting. */
function onContextMenu(e: MouseEvent) {
  const card = (e.target as HTMLElement).closest<HTMLElement>(CARD);
  if (!card) return;
  e.preventDefault();
  clearTimeout(press.timer);
  if (get().selecting) return;
  if ((e as PointerEvent).pointerType === 'touch') return startSelecting(+card.dataset.id!);
  anchorFrom(card.querySelector('.card-more'));
  openNoteMenu(+card.dataset.id!);
}
/** Alt + ↑ / ↓ on a pinned note moves it in the pinned shelf: the keyboard twin of dragging the grip. */
function movePinned(e: KeyboardEvent) {
  const card = (e.target as HTMLElement).closest?.<HTMLElement>(CARD + '[data-pinned]');
  if (!card) return false;
  const shelf = [...document.querySelectorAll<HTMLElement>(CARD + '[data-pinned]')], at = shelf.indexOf(card);
  const target = shelf[at + (e.key === 'ArrowUp' ? -1 : 1)];
  e.preventDefault();
  if (!target) return true;
  reorderPinned(+card.dataset.id!, +target.dataset.id!);
  requestAnimationFrame(() => document.querySelector<HTMLElement>(`${CARD}[data-id="${card.dataset.id}"] .card-open`)?.focus());
  return true;
}
function onPointerOut(e: PointerEvent) {
  const list = document.getElementById('note-list');
  if ((e.target as HTMLElement).closest('#note-list') && !list?.contains(e.relatedTarget as Node) && !swipe.active) clearTimeout(press.timer);
}

/* ---------- Keyboard ---------- */
function trapTab(e: KeyboardEvent) {
  const layer = [...document.querySelectorAll<HTMLElement>('.layer[data-open]:not([data-inspector]), .sheet[data-open]')].pop();
  if (e.key !== 'Tab' || !layer) return false;
  const items = [...layer.querySelectorAll<HTMLElement>('button:not([disabled]),input,[tabindex="0"]')].filter(el => el.offsetParent);
  if (!items.length) return false;
  const first = items[0], last = items[items.length - 1], inside = layer.contains(document.activeElement);
  if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); return true; }
  if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); return true; }
  return false;
}
function onKey(e: KeyboardEvent) {
  if (e.defaultPrevented || trapTab(e)) return;
  const s = get();
  if (e.key === 'Escape') {
    if (s.tour !== null) return void set({ tour: null });
    if (s.layer.mode) return closeLayer();
    if (s.sheet) return closeSheet();
    if (s.searchOpen) return closeSearch();
    if (s.editor.id !== null) return closeEditor();
    if (s.selecting) return endSelecting();
    if (s.page === 'library') return goHome();
    return;
  }
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && movePinned(e)) return;
  if (s.tour !== null && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    e.preventDefault();
    return tourStep(Math.min(TOUR.length, s.tour + (e.key === 'ArrowRight' ? 1 : -1)));
  }
  if (s.sheet === 'study' && !s.layer.mode) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); return s.study.revealed ? answer(true) : reveal(); }
    if (s.study.revealed && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return answer(e.key === 'ArrowRight');
  }
  const free = !isTyping(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey;
  if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && free)) {
    if (s.editor.id !== null || s.layer.mode || isGuiding(s)) return;
    e.preventDefault();
    return s.searchOpen ? document.getElementById('search-input')?.focus() : openSearch();
  }
  if (!free || s.editor.id !== null || s.layer.mode || s.sheet || isGuiding(s)) return;
  const k = e.key.toLowerCase();
  if (k === 'n') { e.preventDefault(); createAndOpen(); }
  else if (k === 'l') { e.preventDefault(); fromTemplate('list'); }
  else if (k === 'd') { e.preventDefault(); dailyNote(); }
  else if (k === 's' && s.page === 'notes') {   // the keyboard twin of a long-press; Space then picks cards, Escape ends
    e.preventDefault();
    if (s.selecting) return endSelecting();
    const card = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('#note-list .card');
    startSelecting(card ? +card.dataset.id! : undefined);
  }
}

function onPaste(e: ClipboardEvent) {
  const s = get();
  if (isTyping(e.target) || s.editor.id !== null || s.layer.mode || s.selecting || s.sheet || isGuiding(s)) return;
  const files = [...(e.clipboardData?.files || [])], text = e.clipboardData?.getData('text/plain') || '';
  if (files.length || text) { e.preventDefault(); importShared({ text, files }); }
}
function onVisibility() {
  if (!document.hidden) return checkReminders();
  flushEditor();
  if (get().hiddenUnlocked) {
    set({ hiddenUnlocked: false });
    const open = noteById(get().editor.id);
    if (open?.locked) closeEditor();
    if (get().layer.mode) closeLayer();
  }
}
const onScroll = () => document.documentElement.classList.toggle('is-scrolled', scrollY > 0);
/** Keyboard height (--kb), only while something takes typing: the browser's own bars coming and going never move the dock. */
function onViewport() {
  const v = visualViewport!, gap = Math.max(0, innerHeight - v.height - v.offsetTop), kb = gap > 60 && isTyping(document.activeElement) ? gap : 0;
  document.documentElement.style.setProperty('--kb', kb + 'px');
  document.documentElement.classList.toggle('kb-open', kb > 0);
}

/** Wires every global listener; returns the cleanup. */
export function bindGestures() {
  const doc: [string, EventListener, AddEventListenerOptions?][] = [
    ['pointerdown', onDown as EventListener], ['pointermove', onMove as EventListener],
    ['pointerup', () => onUp(true)], ['pointercancel', () => onUp(false)], ['pointerout', onPointerOut as EventListener],
    ['contextmenu', onContextMenu as EventListener], ['keydown', onKey as EventListener], ['paste', onPaste as EventListener],
    ['visibilitychange', onVisibility], ['touchstart', onTouchStart as EventListener, { passive: true }],
    ['touchmove', onTouchMove as EventListener, { passive: true }], ['touchend', onTouchEnd], ['touchcancel', onTouchEnd],
  ];
  const focus = () => { if (window.visualViewport) requestAnimationFrame(onViewport); };
  doc.forEach(([t, f, o]) => document.addEventListener(t, f, o));
  addEventListener('scroll', onScroll, { passive: true });
  visualViewport?.addEventListener('resize', onViewport);
  visualViewport?.addEventListener('scroll', onViewport);
  document.addEventListener('focusin', focus);
  document.addEventListener('focusout', focus);
  return () => {
    doc.forEach(([t, f]) => document.removeEventListener(t, f));
    removeEventListener('scroll', onScroll);
    visualViewport?.removeEventListener('resize', onViewport);
    visualViewport?.removeEventListener('scroll', onViewport);
    document.removeEventListener('focusin', focus);
    document.removeEventListener('focusout', focus);
  };
}
