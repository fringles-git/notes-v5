/** App state (Zustand) and the derived selectors every view shares. */
import { create } from 'zustand';
import type { Collection, Layer, Note, Prefs, SheetMode, StudyItem, Toast } from './types';
import type { Vault } from './vault';
import { DEFAULT_FOLDERS, DEFAULT_PREFS, KINDS, TAB_LABEL, type Kind } from './config';
import { checkStats, dueCards, entities, tagsOf } from './markdown';
import { memoArgs } from './utils';

export const EMPTY_LAYER: Omit<Layer, 'mode'> = {
  newFolder: false, editFolders: false, renaming: null, coloring: null, pinStep: null, resetArmed: false,
};

export interface State {
  ready: boolean;
  notes: Note[];
  folders: string[];
  folderColors: Record<string, number>;
  prefs: Prefs;
  pinHash: string | null;
  vault: Vault | null;   // keys of the encrypted hidden notes
  hiddenUnlocked: boolean;
  memOnly: boolean;
  storageInfo: { used: number; persisted: boolean } | null;
  query: string;
  page: 'notes' | 'library';   // the two destinations of the dock; everything else opens over them
  searchOpen: boolean;
  searchKind: Kind | null;
  importTarget: 'new' | 'open';
  selecting: boolean;
  selection: Set<number>;
  deleteArmed: boolean;
  editor: {
    id: number | null;
    saveStatus: 'saved' | 'saving' | 'modified' | 'error';
    lastSaved: number;
    attWarn: boolean;
    reading: boolean;
    snapshot: { title: string; body: string; t: number } | null;
    focus: 'title' | 'reveal' | null;
  };
  layer: Layer;
  menuNote: number | null;
  sheet: SheetMode | null;
  study: { scope: number[]; queue: StudyItem[]; index: number; revealed: boolean; firstTry: number; missed: Set<StudyItem> };
  mapCenter: number | null;
  toast: Toast | null;
  recorder: { on: boolean; startedAt: number };
  player: { id: number | null; playing: boolean; time: number };
  install: { prompt: BeforeInstallPromptEvent | null; ios: boolean; standalone: boolean };
  printing: Note[] | null;
  welcome: boolean;
  tour: number | null;
  newsSince: string | null;
}

export interface BeforeInstallPromptEvent extends Event {
  prompt(): void;
  userChoice: Promise<unknown>;
}

export const useStore = create<State>()(() => ({
  ready: false,
  notes: [],
  folders: DEFAULT_FOLDERS.slice(),
  folderColors: {},
  prefs: { ...DEFAULT_PREFS },
  pinHash: null,
  vault: null,
  hiddenUnlocked: false,
  memOnly: false,
  storageInfo: null,
  query: '',
  page: 'notes',
  searchOpen: false,
  searchKind: null,
  importTarget: 'new',
  selecting: false,
  selection: new Set(),
  deleteArmed: false,
  editor: { id: null, saveStatus: 'saved', lastSaved: 0, attWarn: false, reading: false, snapshot: null, focus: null },
  layer: { mode: null, ...EMPTY_LAYER },
  menuNote: null,
  sheet: null,
  study: { scope: [], queue: [], index: 0, revealed: false, firstTry: 0, missed: new Set() },
  mapCenter: null,
  toast: null,
  recorder: { on: false, startedAt: 0 },
  player: { id: null, playing: false, time: 0 },
  install: { prompt: null, ios: false, standalone: false },
  printing: null,
  welcome: false,
  tour: null,
  newsSince: null,
}));

export const get = useStore.getState;
export const set = useStore.setState;

/* ---------- Smart views ---------- */
export const KIND_TEST: Record<Kind, (n: Note) => boolean> = {
  week: n => n.updated >= Date.now() - 7 * 864e5,
  study: n => dueCards(n).length > 0,
  lists: n => checkStats(n.body).total > 0,
  dated: n => !!n.remind || entities(n).dates.length > 0,
  links: n => entities(n).urls.length > 0,
  photos: n => n.atts.some(a => a.type === 'image'),
  audio: n => n.atts.some(a => a.type === 'audio'),
  pdfs: n => n.atts.some(a => a.type === 'pdf'),
};
export const isKind = (t: string): t is Kind => (KINDS as readonly string[]).includes(t);

/* Tabs: 'all' | kind | 'none' | 'trash' | 'locked' | 'f:<folder>' | 't:<tag>' | 'c:<collection>' */
export const tabLabel = (t: string) => TAB_LABEL[t] || (t[0] === 't' ? '#' : '') + t.slice(2);
export const tabFolder = (t: string) => (t.startsWith('f:') ? t.slice(2) : '');
export const findCollection = (t: string, list: Collection[] = []) => (t.startsWith('c:') ? list.find(c => c.name === t.slice(2)) : undefined);

interface Filter { tab: string; query: string; kind?: Kind | null; unlocked: boolean; collections?: Collection[] }

function inTab(n: Note, tab: string) {
  if (tab === 'trash') return !!n.deleted;
  if (n.deleted) return false;
  if (tab === 'locked') return n.locked;
  if (n.locked) return false;
  if (tab === 'all') return true;
  if (isKind(tab)) return KIND_TEST[tab](n);
  if (tab === 'none') return !n.folder;
  if (tab.startsWith('t:')) return tagsOf(n).includes(tab.slice(2));
  return n.folder === tab.slice(2);
}
const searchable = (n: Note, unlocked: boolean) =>
  n.locked && !unlocked ? n.title : n.title + ' ' + n.body + ' ' + n.atts.filter(a => a.text).map(a => a.text).join('\n');

export function filterNotes(notes: Note[], { tab, query, kind = null, unlocked, collections }: Filter) {
  const c = findCollection(tab, collections);
  const passes = (c ? [c, { tab: 'all', query, kind }] : [{ tab, query, kind }]).map(p => ({ ...p, query: p.query.trim().toLowerCase() }));
  return notes.filter(n => passes.every(p =>
    inTab(n, p.tab) && (!p.query || searchable(n, unlocked).toLowerCase().includes(p.query)) && (!p.kind || KIND_TEST[p.kind as Kind](n))));
}

export const sortNotes = (notes: Note[], { sort, dir }: Pick<Prefs, 'sort' | 'dir'>) => {
  const d = dir === 'desc' ? -1 : 1;
  return notes.slice().sort((a, b) =>
    +b.pinned - +a.pinned || (a.pinned && b.pinned ? (a.pinRank || 0) - (b.pinRank || 0) : 0) || d * ((a[sort] || 0) - (b[sort] || 0)));
};

const visibleMemo = memoArgs((notes: Note[], prefs: Prefs, query: string, kind: Kind | null, unlocked: boolean) =>
  sortNotes(filterNotes(notes, { tab: prefs.tab, query, kind, unlocked, collections: prefs.collections }), prefs));
/** Notes shown in the list right now. */
export const visibleNotes = (s: State) => visibleMemo(s.notes, s.prefs, s.query, s.searchKind, s.hiddenUnlocked);

const readableMemo = memoArgs((notes: Note[], unlocked: boolean) => notes.filter(n => !n.deleted && (!n.locked || unlocked)));
/** Notes whose content may be shown (links, map, backlinks). */
export const readableNotes = (s: State) => readableMemo(s.notes, s.hiddenUnlocked);

export const countIn = (s: State, tab: string) =>
  filterNotes(s.notes, { tab, query: '', unlocked: s.hiddenUnlocked, collections: s.prefs.collections }).length;

/** All notes of the current tab, unfiltered by search (exports, overview). */
export const tabNotes = (s: State = get()) =>
  sortNotes(filterNotes(s.notes, { tab: s.prefs.tab, query: '', unlocked: s.hiddenUnlocked, collections: s.prefs.collections }), s.prefs);

export const openNote = (s: State) => (s.editor.id === null ? null : s.notes.find(n => n.id === s.editor.id) || null);
export const menuNote = (s: State) => (s.menuNote === null ? null : s.notes.find(n => n.id === s.menuNote) || null);
export const noteById = (id: number | null) => (id === null ? undefined : get().notes.find(n => n.id === id));
export const inTrash = (s: State) => s.prefs.tab === 'trash';
export const isGuiding = (s: State) => s.welcome || s.tour !== null;

/* ---------- Folder colors ---------- */
export function folderColor(name: string, colors: Record<string, number>) {
  if (colors[name]) return colors[name];
  let h = 0;
  for (const c of name) h = (31 * h + c.codePointAt(0)!) >>> 0;
  return (h % 8) + 1;
}
export function leastUsedColor(folders: string[], colors: Record<string, number>) {
  const use = Array(9).fill(0);
  folders.forEach(f => use[folderColor(f, colors)]++);
  let best = 1;
  for (let c = 2; c <= 8; c++) if (use[c] < use[best]) best = c;
  return best;
}
