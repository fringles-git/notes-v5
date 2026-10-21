/** Core actions: persistence, toasts, notes, editor, formatting, layers, selection, folders, PIN, search and tabs. */
import { flushSync } from 'react-dom';
import type { Attachment, ChangeKind, LayerMode, Note, Prefs, SheetMode } from './types';
import { CONFIG, MSG, TEMPLATES, type Kind } from './config';
import { canHash, checkPin, deleteNote, hashPin, PIN_SCHEME, putNote, putPref, storageInfo } from './db';
import {
  dropChecked, formatState, isBlank, lineEnd, lineStart, MARKS, minimalDiff, NEXT_HEADING, parseInline, parseLine,
  setLineKind, sinkChecked, toggleCard, tagsOf, toggleCheck, toggleMark, uncheckAll, UNCHECKED, type LineKind, type Mark, titleIndex,
} from './markdown';
import { releaseUrls } from './media';
import { EMPTY_LAYER, findCollection, get, leastUsedColor, menuNote, noteById, openNote, readableNotes, set, tabFolder, tabLabel, useStore, visibleNotes } from './store';
import { addDevice, createVault, forget, isOpen as vaultOpen, openWithDevice, openWithPin, rewrapPin, toRecord, unseal } from './vault';
import { stopRecording } from './features';
import { caretTop, dayTime, focusAt, fullDay, haptic, plural, reducedMotion, replaceText } from './utils';

/* ---------- Persistence ---------- */
export function persist(n: Note) {
  if (get().memOnly) return Promise.resolve();
  return toRecord(n, get().vault).then(putNote).then(() => undefined, (e: DOMException) => {
    toast(e?.name === 'QuotaExceededError' ? 'Stockage plein : cette note n’a pas été enregistrée.' : 'Échec de l’enregistrement de la note.');
    throw e;
  });
}
const persistQuiet = (n: Note) => { persist(n).catch(() => {}); };
const savePref = (id: string, data: unknown) => { if (!get().memOnly) putPref(id, data).catch(() => {}); };
export const saveFolders = () => { savePref('F', get().folders); savePref('FC', get().folderColors); };
const savePin = () => savePref('PIN', get().pinHash);
const saveVault = () => savePref('VAULT', get().vault);
// Closing Notes masquées forgets the private key; the next opening asks again
useStore.subscribe((s, prev) => { if (prev.hiddenUnlocked && !s.hiddenUnlocked) forget(); });

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  set(s => ({ prefs: { ...s.prefs, [key]: value } }));
  savePref('P', get().prefs);
}

/* ---------- Toast ---------- */
let toastTimer = 0;
export function toast(message: string, action: (() => void) | null = null, label = 'Annuler', kind?: ChangeKind) {
  clearTimeout(toastTimer);
  set({ toast: { id: Date.now(), message, label, action, kind } });
  toastTimer = window.setTimeout(hideToast, CONFIG.toastMs);
}
export const hideToast = () => set({ toast: null });
export function runToastAction() {
  const a = get().toast?.action;
  hideToast();
  a?.();
}

/* ---------- Notes CRUD ---------- */
type Patch = Partial<Note> | ((n: Note) => Partial<Note>);
export function updateNotes(list: Note[], patch: Patch, { touch = false } = {}) {
  const now = Date.now(), next = new Map<number, Note>();
  list.forEach(n => next.set(n.id, { ...n, ...(typeof patch === 'function' ? patch(n) : patch), ...(touch ? { updated: now } : {}) }));
  set(s => ({ notes: s.notes.map(n => next.get(n.id) || n) }));
  next.forEach(persistQuiet);
  return [...next.values()];
}
export const updateNote = (n: Note, patch: Patch, o?: { touch?: boolean }) => updateNotes([n], patch, o)[0];
/** Current versions of notes captured earlier (undo closures). */
export const fresh = (list: Note[]) => list.map(n => noteById(n.id)).filter((n): n is Note => !!n);

export function removeNotes(list: Note[]) {
  const ids = new Set(list.map(n => n.id));
  set(s => ({ notes: s.notes.filter(n => !ids.has(n.id)) }));
  if (!get().memOnly) ids.forEach(id => deleteNote(id).catch(() => {}));
  releaseUrls(get().notes);
}
export function addNotes(list: Note[]) {
  set(s => ({ notes: s.notes.concat(list) }));
  list.forEach(persistQuiet);
}
export const trashNotes = (list: Note[], at = Date.now()) => updateNotes(list, { deleted: true, deletedAt: at });
export const untrashNotes = (list: Note[]) => updateNotes(list, { deleted: false, deletedAt: null });
export function trashWithUndo(list: Note[], message: string) {
  trashNotes(list);
  toast(message, () => untrashNotes(fresh(list)));
}
export function restoreWithUndo(list: Note[], message: string) {
  const when = list.map(n => n.deletedAt || Date.now());
  untrashNotes(list);
  toast(message, () => fresh(list).forEach((n, i) => trashNotes([n], when[i])));
}
export function deleteForever(list: Note[]) {
  removeNotes(list);
  toast(plural(list.length, 'note supprimée', 'notes supprimées') + ' définitivement', () => addNotes(list));
}

let lastId = 0;
export const syncLastId = () => { lastId = Math.max(lastId, 0, ...get().notes.map(n => n.id)); };
export function createNote(fields: Partial<Note> = {}) {
  const now = Date.now(), prefs = get().prefs;
  lastId = now > lastId ? now : lastId + 1;
  const n: Note = {
    id: lastId, title: '', body: '', folder: tabFolder(prefs.tab), by: 'me', created: now, updated: now,
    pinned: false, locked: false, atts: [], versions: [], ...fields,
  };
  set(s => ({ notes: [n, ...s.notes] }));
  persistQuiet(n);
  return n;
}
export function createAndOpen(fields: Partial<Note> = {}, heavy = false) {
  openEditor(createNote(fields).id);
  if (heavy) patchEditor({ attWarn: true });
}

/** Animates cards out before a removal (respecting reduced motion). */
export function leaveThen(list: Note[], then: () => void) {
  const cards = list.map(n => document.querySelector(`#note-list .card[data-id="${n.id}"]`)).filter((c): c is Element => !!c);
  if (!cards.length || reducedMotion()) return then();
  cards.forEach(c => c.classList.add('is-leaving'));
  setTimeout(then, 180);
}

/* ---------- Editor ---------- */
export const editorRefs: { title: HTMLInputElement | null; body: HTMLTextAreaElement | null; keep: { line: number; top: number } | null } =
  { title: null, body: null, keep: null };
export const patchEditor = (p: Partial<ReturnType<typeof get>['editor']>) => set(s => ({ editor: { ...s.editor, ...p } }));
const shouldRead = (body: string) => !isBlank(body);

let dirty = false, saveTimer = 0;
const cancelSave = () => { clearTimeout(saveTimer); saveTimer = 0; };

export function openEditor(id: number) {
  const n = noteById(id);
  if (!n) return;
  const s = get();
  if (s.editor.id !== null && s.editor.id !== id) closeEditor();
  if (s.searchOpen) rememberSearch(s.query);
  dirty = false;
  const empty = !n.title && !n.body && !n.atts.length;
  patchEditor({
    id, saveStatus: 'saved', lastSaved: n.updated, attWarn: false, reading: shouldRead(n.body),
    snapshot: { title: n.title, body: n.body, t: n.updated },
    focus: empty ? 'title' : s.searchOpen && s.query.trim() ? 'reveal' : null,
  });
  haptic('open');
}
/** Opens a note, asking for the PIN first when it is hidden. */
export function open(id: number) {
  const n = noteById(id);
  if (n?.locked && !get().hiddenUnlocked) unlock(() => openEditor(id));
  else openEditor(id);
}

function saveNow() {
  cancelSave();
  const n = openNote(get());
  if (!n) return;
  dirty = false;
  patchEditor({ saveStatus: 'saving' });
  persist(n)
    .then(() => { if (get().editor.id === n.id) patchEditor({ saveStatus: 'saved', lastSaved: Date.now() }); })
    .catch(() => { if (get().editor.id === n.id) { dirty = true; patchEditor({ saveStatus: 'error' }); } });
}
export function flushEditor() {
  if (get().editor.id === null) return;
  snapshotVersion();
  saveNow();
}

/** Edits the open note; saves after a short pause (or now). */
export function editNote(patch: Partial<Note>, { save = 'later', touch = true }: { save?: 'later' | 'now'; touch?: boolean } = {}) {
  const n = openNote(get());
  if (!n) return null;
  const next = { ...n, ...patch, ...(touch ? { updated: Date.now() } : {}) };
  set(s => ({ notes: s.notes.map(x => (x.id === n.id ? next : x)) }));
  dirty = true;
  if (save === 'now') saveNow();
  else { patchEditor({ saveStatus: 'modified' }); cancelSave(); saveTimer = window.setTimeout(saveNow, CONFIG.saveDelay); }
  return next;
}
export const editField = (field: 'title' | 'body', value: string) => editNote({ [field]: value });

const pushVersion = (versions: Note['versions'], v: Note['versions'][number]) =>
  (v.title.trim() || v.body.trim()) && (!versions[0] || versions[0].title !== v.title || versions[0].body !== v.body)
    ? [v, ...versions].slice(0, CONFIG.versionsMax) : versions;

function snapshotVersion() {
  const n = openNote(get()), snap = get().editor.snapshot;
  if (!n || !snap) return;
  if (snap.title !== n.title || snap.body !== n.body) {
    const v = pushVersion(n.versions, snap);
    if (v !== n.versions) editNote({ versions: v }, { touch: false });
  }
  const cur = openNote(get())!;
  patchEditor({ snapshot: { title: cur.title, body: cur.body, t: cur.updated } });
}

export function closeEditor() {
  if (openNote(get())) {
    cancelSave();
    snapshotVersion();
    const n = openNote(get())!, sunk = sinkChecked(n.body);
    if (sunk !== n.body) editNote({ body: sunk }, { touch: false });
    const cur = openNote(get())!;
    if (!cur.title.trim() && isBlank(cur.body) && !cur.atts.length) removeNotes([cur]);
    else if (dirty) saveNow();
  }
  dirty = false;
  patchEditor({ id: null, snapshot: null, focus: null });
  (document.activeElement as HTMLElement | null)?.blur();
}

export function restoreVersion(i: number) {
  const n = openNote(get()), v = n?.versions[i];
  if (!n || !v) return;
  closeLayer();
  snapshotVersion();
  const cur = openNote(get())!;
  editNote({ title: v.title, body: v.body, versions: pushVersion(cur.versions, { title: cur.title, body: cur.body, t: cur.updated }) }, { save: 'now' });
  patchEditor({ reading: shouldRead(v.body), snapshot: { title: v.title, body: v.body, t: Date.now() } });
  toast('Version du ' + dayTime(v.t) + ' restaurée.');
}

/** Leaves the formatted view and puts the caret at a line/offset of the source. */
export function editAt(line: number | null, offset?: number, keepTop?: number) {
  flushSync(() => patchEditor({ reading: false }));
  const el = editorRefs.body;
  if (!el) return;
  const lines = el.value.split('\n'), lineAt = line === null ? 0 : lines.slice(0, line).join('\n').length + +!!line;
  let pos = el.value.length;
  if (line !== null) {
    pos = lineAt + lines[line].length;
    if (offset !== undefined) {
      const p = parseLine(lines[line]);
      let left = offset;
      pos = lineAt + lines[line].length;
      for (const leaf of parseInline(p.text, p.prefix.length).leaves) {
        if (left <= leaf.text.length) { pos = lineAt + leaf.at + left; break; }
        left -= leaf.text.length;
      }
    }
  }
  focusAt(el, pos, keepTop === undefined ? undefined : caretTop(el, lineAt) - keepTop);
}

/** Shows the formatted view again when the textarea loses focus. */
export function backToReading() {
  const n = openNote(get()), el = editorRefs.body;
  if (!n || !el || get().editor.reading || !document.hasFocus() || !shouldRead(n.body)) return;
  const at = lineStart(el.value, el.selectionStart);
  editorRefs.keep = { line: el.value.slice(0, at).split('\n').length - 1, top: caretTop(el, at) - el.scrollTop };
  patchEditor({ reading: true });
}

/* ---------- Formatting ---------- */
export type FormatTool = Mark | LineKind | 'heading' | 'card';
export const FORMAT_TOOLS: { id: FormatTool; label: string; keys: string; glyph?: string; icon?: string }[] = [
  { id: 'heading', label: 'Titre', keys: 'Alt+1, 2, 3', glyph: 'H' },
  { id: 'b', label: 'Gras', keys: 'B', glyph: 'B' },
  { id: 'i', label: 'Italique', keys: 'I', glyph: 'I' },
  { id: 'hl', label: 'Surligner', keys: 'Maj+H', icon: 'highlight' },
  { id: 'bullet', label: 'Liste à puces', keys: 'Maj+8', icon: 'bullets' },
  { id: 'number', label: 'Liste numérotée', keys: 'Maj+7', icon: 'numbers' },
  { id: 'check', label: 'Liste à cocher', keys: 'Maj+9', icon: 'checklist' },
  { id: 'link', label: 'Lien vers une note', keys: 'K', icon: 'link' },
  { id: 'card', label: 'Carte à réviser (Question :: Réponse)', keys: 'Maj+K', glyph: '::' },
];
const SHORTCUTS: Record<string, FormatTool> = {
  KeyB: 'b', KeyI: 'i', 'Shift+KeyH': 'hl', 'Shift+Digit8': 'bullet', 'Shift+Digit7': 'number', 'Shift+Digit9': 'check',
  KeyK: 'link', 'Shift+KeyK': 'card', 'Alt+Digit1': 'h1', 'Alt+Digit2': 'h2', 'Alt+Digit3': 'h3', 'Alt+Digit0': 'text',
};
/** Aa: the formatting tools take the place of the note tools; turning them on starts writing (they serve the caret). */
export function toggleFormatBar() {
  const on = !get().prefs.formatBar;
  setPref('formatBar', on);
  if (on && get().editor.reading) editAt(null);
}

export function applyFormat(tool: FormatTool) {
  const el = editorRefs.body;
  if (!el) return;
  if (get().editor.reading) {
    editAt(null);
    if (!(tool in MARKS) && el.value.slice(lineStart(el.value, el.value.length)).trim()) replaceText(el, el.value.length, el.value.length, '\n');
  }
  const { value, selectionStart: a, selectionEnd: b } = el;
  const edit = tool === 'card' ? toggleCard(value, a, b) : tool === 'heading'
    ? setLineKind(value, a, b, NEXT_HEADING[parseLine(value.slice(lineStart(value, a), lineEnd(value, a))).kind] || 'h1')
    : tool in MARKS ? toggleMark(value, a, b, tool as Mark) : setLineKind(value, a, b, tool as LineKind);
  const d = minimalDiff(value, edit.value);
  replaceText(el, d.start, d.end, d.text);
  el.setSelectionRange(edit.start, edit.end);
}

export function onEditorKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
  if (e.metaKey || e.ctrlKey) {
    const tool = SHORTCUTS[(e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + e.nativeEvent.code];
    if (tool) { e.preventDefault(); applyFormat(tool); }
    return;
  }
  const el = e.currentTarget;
  if (el.selectionStart !== el.selectionEnd || e.nativeEvent.isComposing) return;
  const v = el.value, at = el.selectionStart, from = lineStart(v, at), line = parseLine(v.slice(from, lineEnd(v, at)));
  if (!line.prefix) return;
  if (e.key === 'Enter' && !e.shiftKey && (line.kind === 'bullet' || line.kind === 'number' || line.kind === 'check')) {
    e.preventDefault();
    if (line.text.trim())
      replaceText(el, at, at, '\n' + (line.kind === 'check' ? UNCHECKED : line.kind === 'number' ? line.prefix.replace(/\d+/, String(line.n + 1)) : line.prefix));
    else replaceText(el, from, from + line.prefix.length, '');
  } else if (e.key === 'Backspace' && at === from + line.prefix.length) {
    e.preventDefault();
    replaceText(el, from, at, '');
  }
}
export const caretFormat = () => {
  const el = editorRefs.body;
  return el && document.activeElement === el ? formatState(el.value, el.selectionStart, el.selectionEnd) : null;
};

/* ---------- Checklists ---------- */
export function toggleOpenCheck(line: number, on: boolean) {
  const n = openNote(get()), body = n && toggleCheck(n.body, line, on);
  if (body != null) editNote({ body });
}
const sinkTimers = new Map<number, number>();
/** Checking from a card: save now, sink checked items a moment later. */
export function toggleCardCheck(id: number, line: number, on: boolean) {
  const n = noteById(id), body = n && toggleCheck(n.body, line, on);
  if (body == null) return;
  updateNote(n!, { body }, { touch: true });
  clearTimeout(sinkTimers.get(id));
  sinkTimers.set(id, window.setTimeout(() => {
    sinkTimers.delete(id);
    const cur = noteById(id);
    if (!cur || get().editor.id === id) return;
    const sunk = sinkChecked(cur.body);
    if (sunk !== cur.body) updateNote(cur, { body: sunk });
  }, 1200));
}
function bulkList(fn: (b: string) => string, message: string) {
  const n = openNote(get());
  if (!n) return;
  const before = n.body;
  closeLayer();
  editNote({ body: fn(before) });
  toast(message, () => editNote({ body: before }));
}
export const uncheckList = () => bulkList(uncheckAll, 'Liste décochée');
export const clearChecked = () => bulkList(dropChecked, 'Éléments cochés supprimés');

/* ---------- Creating ---------- */
/** Turns the open (empty) note into a list, a flashcard, a meeting… and puts the caret where to type. */
const todayNote = () => { const title = fullDay(Date.now()); return get().notes.find(n => !n.deleted && n.title === title); };
export function applyTemplate(id: string) {
  const t = TEMPLATES.find(x => x.id === id)!, n = openNote(get()), today = id === 'today' && todayNote();
  if (!n) return;
  if (today && today.id !== n.id) return open(today.id);
  editNote({ title: n.title || t.title(new Date()), body: t.body.replace('¦', '') });
  flushSync(() => patchEditor({ focus: null, reading: false }));
  if (editorRefs.body) focusAt(editorRefs.body, Math.max(0, t.body.indexOf('¦')));
}
export function fromTemplate(id: string) {
  closeLayer();
  createAndOpen();
  applyTemplate(id);
}
export function dailyNote() {
  closeLayer();
  const today = todayNote();
  if (today) return open(today.id);
  fromTemplate('today');
}
/** [[Title]]: opens that note, or creates it. */
export function openLink(title: string) {
  const n = titleIndex(readableNotes(get())).get(title.toLowerCase());
  if (n) return open(n.id);
  createAndOpen({ title });
  patchEditor({ focus: null });
  queueMicrotask(() => editorRefs.body?.focus());
}
export function extractSelection() {
  const n = openNote(get()), el = editorRefs.body;
  if (!n || !el) return;
  const text = el.value.slice(el.selectionStart, el.selectionEnd).trim();
  if (!text) return;
  const words = text.split(/\s+/);
  const made = createNote({
    title: words.slice(0, 6).join(' ') + (words.length > 6 ? '…' : ''),
    body: text + (n.title.trim() ? '\n\n— [[' + n.title.trim() + ']]' : ''), folder: n.folder, locked: n.locked,
  });
  toast('Note créée avec la sélection.', () => open(made.id), 'Ouvrir');
}
export function removeAtt(i: number) {
  const n = openNote(get());
  if (!n) return;
  const before = n.atts;
  editNote({ atts: before.filter((_, k) => k !== i) }, { save: 'now' });
  patchEditor({ attWarn: false });
  toast('Pièce jointe retirée', () => { const cur = noteById(n.id); if (cur) updateNote(cur, { atts: before }); });
  releaseUrls(get().notes);
}
export function patchAtt(id: number, blob: Blob, p: Partial<Attachment>) {
  const n = noteById(id);
  if (n) updateNote(n, { atts: n.atts.map(a => (a.blob === blob ? { ...a, ...p } : a)) });
}

/* ---------- Layers (bottom sheets) and full sheets ---------- */
export const openLayer = (mode: LayerMode) => set(s => ({ layer: { ...s.layer, mode } }));
export const patchLayer = (p: Partial<typeof EMPTY_LAYER>) => set(s => ({ layer: { ...s.layer, ...p } }));
let pinThen: (() => void) | null = null;
export function closeLayer() {
  pinThen = null;
  set({ layer: { mode: null, ...EMPTY_LAYER }, menuNote: null });
}
export const toggleLayer = (mode: LayerMode) => (get().layer.mode === mode ? closeLayer() : set({ layer: { mode, ...EMPTY_LAYER } }));
export const openPicker = () => set({ layer: { mode: 'picker', ...EMPTY_LAYER } });
export function openImport(target: 'new' | 'open') {
  set({ importTarget: target });
  toggleLayer('import');
}
export function openNoteMenu(id: number) {
  set({ menuNote: id });
  openLayer('note-menu');
}
export function openSheet(mode: SheetMode) {
  if (get().layer.mode) closeLayer();
  if (mode === 'settings') refreshStorage();
  set({ sheet: mode });
}
export const closeSheet = () => set({ sheet: null });
export const toggleSettings = () => (get().sheet === 'settings' ? closeSheet() : openSheet('settings'));
/** The Library is a page, like the list: the dock stays, Notes brings you back. */
export function goLibrary() {
  closeLayer();
  closeSheet();
  if (get().searchOpen) closeSearch();
  if (get().selecting) endSelecting();
  set({ page: 'library' });
  scrollTo(0, 0);
}
export async function refreshStorage() { set({ storageInfo: await storageInfo() }); }

/** Note menu actions act on the note the menu was opened for. */
const onMenuNote = (fn: (n: Note) => void) => () => {
  const n = menuNote(get());
  closeLayer();
  if (n) fn(n);
};
/** A card's quick actions (mouse): the menu's own actions, without opening the menu. */
export const onCard = (id: number, action: () => void) => { set({ menuNote: id }); action(); };
const isOpen = (n: Note) => get().editor.id === n.id;
export const menuPin = onMenuNote(n => toggleFlag([n], 'pinned'));
export const menuHide = onMenuNote(n => toggleHidden([n]));
export const menuTrash = onMenuNote(n => (isOpen(n) ? trashOpenNote() : leaveThen([n], () => trashWithUndo(fresh([n]), MSG.trashed))));
export const menuRestore = onMenuNote(n => (isOpen(n) ? editNote({ deleted: false, deletedAt: null }, { save: 'now' }) : restoreWithUndo([n], 'Note restaurée')));
export const menuDeleteForever = onMenuNote(n => {
  if (isOpen(n)) { cancelSave(); dirty = false; patchEditor({ id: null, snapshot: null }); }
  leaveThen([n], () => deleteForever([n]));
});
export function trashOpenNote() {
  const n = openNote(get());
  if (!n) return;
  if (n.deleted) return void editNote({ deleted: false, deletedAt: null }, { save: 'now' });
  cancelSave();
  dirty = false;
  patchEditor({ id: null, snapshot: null });
  trashWithUndo([n], MSG.trashed);
}

/* ---------- Selection ---------- */
let armTimer = 0;
const disarm = () => { clearTimeout(armTimer); set({ deleteArmed: false }); };
export const selectedNotes = () => { const sel = get().selection; return get().notes.filter(n => sel.has(n.id)); };
export function startSelecting(id?: number) {
  const s = get();
  if (s.selecting) return;
  if (s.editor.id !== null) closeEditor();
  if (s.searchOpen) closeSearch();
  set({ selecting: true, selection: new Set(id === undefined ? [] : [id]) });
  if (id !== undefined) haptic('selectionStart');
}
export function endSelecting() { disarm(); set({ selecting: false, selection: new Set() }); }
export function toggleSelected(id: number) {
  disarm();
  set(s => {
    const sel = new Set(s.selection);
    if (sel.has(id)) sel.delete(id); else sel.add(id);
    return { selection: sel };
  });
}
export const allSelected = (s = get()) => { const v = visibleNotes(s); return v.length > 0 && v.every(n => s.selection.has(n.id)); };
export function selectAll() { disarm(); set(s => ({ selection: new Set(allSelected(s) ? [] : visibleNotes(s).map(n => n.id)) })); }

const FLAG_MSG = {
  pinned: { on: ['note épinglée', 'notes épinglées'], off: ['note désépinglée', 'notes désépinglées'] },
  locked: { on: ['note masquée', 'notes masquées'], off: ['note affichée', 'notes affichées'] },
} as const;
export function toggleFlag(list: Note[], flag: 'pinned' | 'locked') {
  const on = !list.every(n => n[flag]), before = new Map(list.map(n => [n.id, n[flag]])), [one, many] = FLAG_MSG[flag][on ? 'on' : 'off'];
  updateNotes(list, n => (flag === 'pinned' && on && !n.pinned ? { pinned: true, pinRank: -Date.now() } : { [flag]: on }), { touch: flag === 'pinned' });
  toast(plural(list.length, one, many), () => fresh(list).forEach(n => updateNote(n, { [flag]: before.get(n.id) })));
}
export function toggleHidden(list: Note[]) {
  const run = () => toggleFlag(fresh(list), 'locked');
  if (list.every(n => n.locked)) unlock(run);
  else if (get().pinHash) run();
  else askPin('new', run);
}
const onSelection = (fn: (l: Note[]) => void) => () => { const l = selectedNotes(); if (l.length) fn(l); };
export const pinSelection = onSelection(l => { endSelecting(); toggleFlag(l, 'pinned'); });
export const hideSelection = onSelection(l => { endSelecting(); toggleHidden(l); });
export const restoreSelection = onSelection(l => { endSelecting(); restoreWithUndo(l, plural(l.length, 'note restaurée', 'notes restaurées')); });
export const deleteSelection = onSelection(l => {
  const trash = get().prefs.tab === 'trash';
  if (trash && !get().deleteArmed) {
    set({ deleteArmed: true });
    armTimer = window.setTimeout(() => set({ deleteArmed: false }), 3000);
    return void haptic('confirm');
  }
  endSelecting();
  leaveThen(l, () => (trash ? deleteForever(l) : trashWithUndo(fresh(l), plural(l.length, 'note placée', 'notes placées') + ' dans la corbeille')));
});
export const moveSelection = () => { if (get().selection.size) openPicker(); };

/** What a swipe does: right pins (or restores), left trashes. */
export function swipeAction(n: Note, dir: number) {
  if (n.deleted) return dir > 0 ? { kind: 'restore', label: 'Restaurer', icon: 'restore', tone: 'accent' } as const : null;
  return dir > 0
    ? { kind: 'pin', label: n.pinned ? 'Désépingler' : 'Épingler', icon: 'pin', tone: 'accent' } as const
    : { kind: 'trash', label: 'Supprimer', icon: 'trash', tone: 'danger' } as const;
}
export function doSwipe(n: Note, kind: 'pin' | 'trash' | 'restore') {
  if (kind === 'pin') toggleFlag([n], 'pinned');
  else if (kind === 'trash') trashWithUndo([n], MSG.trashed);
  else restoreWithUndo([n], 'Note restaurée');
}
export function reorderPinned(dragId: number, targetId: number) {
  const pinned = visibleNotes(get()).filter(n => n.pinned && !n.deleted), to = pinned.findIndex(n => n.id === targetId);
  const [moved] = pinned.splice(pinned.findIndex(n => n.id === dragId), 1);
  pinned.splice(to, 0, moved);
  updateNotes(pinned, n => ({ pinRank: pinned.findIndex(p => p.id === n.id) }));
}

/* ---------- Folders ---------- */
export const toggleNewFolder = () => patchLayer({ newFolder: !get().layer.newFolder, renaming: null });
export const toggleEditFolders = () => patchLayer({ editFolders: !get().layer.editFolders, renaming: null, coloring: null });
function addFolder(name: string) {
  set(s => ({ folderColors: { ...s.folderColors, [name]: leastUsedColor(s.folders, s.folderColors) }, folders: [...s.folders, name] }));
  saveFolders();
}
export function submitFolder(raw: string) {
  const name = raw.trim();
  if (!name) return;
  if (get().layer.mode === 'picker') { if (!get().folders.includes(name)) addFolder(name); return moveTo(name); }
  if (get().folders.includes(name)) return toast(MSG.folderExists);
  addFolder(name);
  setTab('f:' + name);
}
export function renameFolder(raw: string) {
  const s = get(), old = s.layer.renaming, name = raw.trim();
  if (old === null) return;
  if (!name || name === old) return patchLayer({ renaming: null });
  if (s.folders.includes(name)) return toast(MSG.folderExists);
  const colors = { ...s.folderColors, [name]: s.folderColors[old] || 0 };
  delete colors[old];
  set({ folders: s.folders.map(f => (f === old ? name : f)), folderColors: colors });
  updateNotes(s.notes.filter(n => n.folder === old), { folder: name });
  if (s.prefs.tab === 'f:' + old) setPref('tab', 'f:' + name);
  patchLayer({ renaming: null });
  saveFolders();
}
export function deleteFolder(name: string) {
  const s = get(), at = s.folders.indexOf(name), inside = s.notes.filter(n => n.folder === name), tab = s.prefs.tab, color = s.folderColors[name];
  const colors = { ...s.folderColors };
  delete colors[name];
  set({ folders: s.folders.filter(f => f !== name), folderColors: colors });
  patchLayer({ renaming: null });
  updateNotes(inside, { folder: '' });
  if (tab === 'f:' + name) setPref('tab', 'all');
  saveFolders();
  toast('Dossier supprimé', () => {
    set(c => {
      const folders = c.folders.slice();
      folders.splice(at, 0, name);
      return { folders, folderColors: color ? { ...c.folderColors, [name]: color } : c.folderColors };
    });
    updateNotes(fresh(inside), { folder: name });
    setPref('tab', tab);
    saveFolders();
  });
}
export function setFolderColor(name: string, color: number) {
  set(s => ({ folderColors: { ...s.folderColors, [name]: color } }));
  saveFolders();
  patchLayer({ coloring: null });
}
export function moveTo(folder: string) {
  if (get().selecting) {
    const moved = updateNotes(selectedNotes(), { folder }, { touch: true });
    closeLayer();
    endSelecting();
    return toast(plural(moved.length, 'note déplacée', 'notes déplacées'));
  }
  const n = menuNote(get()) || openNote(get());
  if (!n) return;
  closeLayer();
  if (isOpen(n)) editNote({ folder }, { save: 'now' });
  else { updateNotes([n], { folder }, { touch: true }); toast(folder ? 'Note déplacée dans ' + folder : 'Note retirée de son dossier'); }
}

/* ---------- PIN ---------- */
export function askPin(step: 'new' | 'auth' | 'change', then: (() => void) | null) {
  set(s => ({ layer: { ...s.layer, mode: 'pin', pinStep: step, resetArmed: false } }));
  pinThen = then;
}
export function unlock(then: () => void) {
  if (get().hiddenUnlocked) return then();
  askPin(get().pinHash ? 'auth' : 'new', then);
}
export const changePin = () => askPin('change', null);

/** Decrypts the hidden notes into memory (after the PIN or the device). Notes hidden under an older PIN are sealed now. */
async function revealHidden(then: (() => void) | null) {
  const opened = new Map<number, Note>();
  await Promise.all(get().notes.filter(n => n.sealedOnly && n.sealed).map(async n => {
    try { opened.set(n.id, { ...n, ...(await unseal(n.sealed!)), sealedOnly: false }); } catch { /* unreadable: stays sealed */ }
  }));
  if (opened.size) set(s => ({ notes: s.notes.map(n => opened.get(n.id) || n) }));
  get().notes.filter(n => n.locked && !n.sealed).forEach(persistQuiet);
  set({ hiddenUnlocked: true });
  closeLayer();
  then?.();
}
/** Face ID / fingerprint, where the vault has it. */
export async function unlockWithDevice() {
  const v = get().vault, then = pinThen;
  if (!v?.device) return;
  try { await openWithDevice(v); } catch { return toast('Déverrouillage annulé : saisissez le code PIN.'); }
  await revealHidden(then);
}
/** Réglages: adds or removes Face ID / fingerprint. Needs the notes open, and a fresh tap for the system prompt. */
export async function toggleDeviceUnlock() {
  const v = get().vault;
  if (!v) return;
  if (v.device) {
    set({ vault: { ...v, device: undefined } });
    saveVault();
    return toast('Face ID ou empreinte retiré : le code PIN ouvre les notes masquées.');
  }
  if (!get().hiddenUnlocked || !vaultOpen()) return unlock(() => toast('Notes masquées ouvertes : touchez à nouveau pour ajouter Face ID ou l’empreinte.'));
  try {
    set({ vault: await addDevice(v) });
    saveVault();
    toast('Face ID ou empreinte ajouté : il ouvre les notes masquées.');
  } catch (e) {
    toast((e as Error).message === 'no-prf' ? 'Cet appareil ne sait pas chiffrer avec la biométrie : gardez le code PIN.' : 'Ajout annulé.');
  }
}
let pinBusy = false;
/** Returns true when the input may be cleared and closed. */
export async function submitPin(raw: string) {
  if (pinBusy) return true;
  pinBusy = true;
  try {
    const s = get(), step = s.layer.pinStep, then = pinThen, pin = raw.trim();
    if (step === 'new') {
      if (pin.length < 4) { toast('Le code PIN doit contenir au moins 4 chiffres.'); return true; }
      if (!canHash()) { toast('Un code PIN demande une page sécurisée (https).'); return true; }
      const v = s.vault;
      set({ pinHash: await hashPin(pin), vault: !v ? await createVault(pin) : vaultOpen() ? await rewrapPin(v, pin) : v });
      savePin();
      saveVault();
      closeLayer();
      toast('Code PIN enregistré.');
      then?.();
      if (!get().hiddenUnlocked) forget();
      return true;
    }
    if (!(await checkPin(pin, s.pinHash))) { toast('Code PIN incorrect.'); return false; }
    // The same PIN opens the vault (or creates it, for notes hidden before encryption)
    if (s.vault) await openWithPin(s.vault, pin);
    else { set({ vault: await createVault(pin) }); saveVault(); }
    if (step === 'change') { patchLayer({ pinStep: 'new' }); return false; }
    if (!(s.pinHash || '').startsWith(PIN_SCHEME) && canHash()) { set({ pinHash: await hashPin(pin) }); savePin(); }
    await revealHidden(then);
    return true;
  } finally { pinBusy = false; }
}
export function resetPin() {
  if (!get().layer.resetArmed) return patchLayer({ resetArmed: true });
  const hidden = get().notes.filter(n => n.locked);
  removeNotes(hidden);
  set({ pinHash: null, vault: null });
  forget();
  savePin();
  saveVault();
  patchLayer({ pinStep: 'new', resetArmed: false });
  toast(hidden.length ? plural(hidden.length, 'note supprimée', 'notes supprimées') + ' définitivement' : 'Code PIN réinitialisé.');
}

/* ---------- Tabs ---------- */
export function setTab(tab: string) {
  const s = get();
  if (tab === 'locked' && !s.hiddenUnlocked) return unlock(() => { set({ hiddenUnlocked: true }); setTab(tab); });
  if (tab !== 'locked') set({ hiddenUnlocked: false });
  if (s.selecting) endSelecting();
  setPref('tab', tab);
  set({ page: 'notes' });
  if (get().layer.mode) closeLayer();
}
/** Falls back to "all" when the current tab no longer exists. */
export function checkTab() {
  const s = get(), t = s.prefs.tab;
  if ((t.startsWith('f:') && !s.folders.includes(t.slice(2))) || (t === 'locked' && !s.hiddenUnlocked)
    || (t.startsWith('t:') && !s.notes.some(n => !n.deleted && tagsOf(n).includes(t.slice(2))))
    || (t.startsWith('c:') && !findCollection(t, s.prefs.collections))) setPref('tab', 'all');
}
export function goHome() {
  closeLayer();
  closeSheet();
  const s = get();
  if (s.searchOpen) closeSearch();
  else if (s.prefs.tab !== 'all' || s.page !== 'notes') setTab('all');
  else scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/* ---------- Search ---------- */
export function openSearch() {
  const s = get();
  if (s.recorder.on) stopRecording();
  if (s.selecting) endSelecting();
  closeLayer();
  closeSheet();
  set({ searchOpen: true, page: 'notes' });
}
export function closeSearch() {
  rememberSearch(get().query);
  set({ searchOpen: false, query: '', searchKind: null });
}
export const setQuery = (query: string) => set({ query });
export const toggleKind = (k: Kind) => set(s => ({ searchKind: s.searchKind === k ? null : k }));
export function rememberSearch(q: string) {
  const t = q.trim();
  if (t.length < 2) return;
  setPref('recentSearches', [t, ...(get().prefs.recentSearches || []).filter(r => r.toLowerCase() !== t.toLowerCase())].slice(0, 5));
}
export const clearRecents = () => setPref('recentSearches', []);
const collections = () => get().prefs.collections || [];
export function saveCollection() {
  const s = get(), q = s.query.trim(), kind = s.searchKind;
  if (!q && !kind) return;
  const tab = s.prefs.tab === 'trash' || s.prefs.tab === 'locked' || s.prefs.tab.startsWith('c:') ? 'all' : s.prefs.tab;
  const base = [q && '« ' + q + ' »', kind && tabLabel(kind), tab !== 'all' && tabLabel(tab)].filter(Boolean).join(' · ');
  let name = base, i = 1;
  while (collections().some(c => c.name === name)) name = base + ' (' + ++i + ')';
  setPref('collections', [...collections(), { name, tab, query: q, kind }]);
  rememberSearch(q);
  toast('Collection ajoutée à la Bibliothèque.', () => { closeSearch(); setTab('c:' + name); }, 'Ouvrir');
}
export function renameCollection(old: string, raw: string) {
  const name = raw.trim();
  patchLayer({ renaming: null });
  if (!name || name === old) return;
  if (collections().some(c => c.name === name)) return toast('Une collection porte déjà ce nom.');
  setPref('collections', collections().map(c => (c.name === old ? { ...c, name } : c)));
  if (get().prefs.tab === 'c:' + old) setPref('tab', 'c:' + name);
}
export function deleteCollection(name: string) {
  const before = collections();
  setPref('collections', before.filter(c => c.name !== name));
  checkTab();
  toast('Collection supprimée.', () => setPref('collections', before));
}
export function emptyTrash() {
  const t = get().notes.filter(n => n.deleted);
  if (t.length) deleteForever(t);
}
