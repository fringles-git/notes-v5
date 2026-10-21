import type { Sealed } from './vault';

export type AttType = 'image' | 'audio' | 'pdf';

export interface Attachment {
  type: AttType;
  blob?: Blob;
  url?: string;           // data: URL, only inside backups
  size?: number;
  name?: string;
  text?: string;          // PDF text or OCR text, searchable
  pages?: number;
  peaks?: number[];
  duration?: number;
}

export interface Version { title: string; body: string; t: number }
export interface CardProgress { box: number; due: number }

export interface Note {
  id: number;
  title: string;
  body: string;
  folder: string;
  by: 'me' | 'ai';
  created: number;
  updated: number;
  pinned: boolean;
  pinRank?: number;
  locked: boolean;
  deleted?: boolean;
  deletedAt?: number | null;
  remind?: number | null;
  remindDone?: boolean;
  atts: Attachment[];
  versions: Version[];
  cards?: Record<string, CardProgress>;
  sealed?: Sealed;        // a hidden note's content, encrypted (see vault.ts)
  sealedOnly?: boolean;   // the content is only in `sealed`: not opened yet this session
}

export interface Collection { name: string; tab: string; query: string; kind: string | null }

export interface Prefs {
  tab: string;
  view: 'cards' | 'list';
  sort: 'updated' | 'created';
  dir: 'desc' | 'asc';
  theme: 'auto' | 'light' | 'dark';
  hand: 'right' | 'left';
  tint: 'off' | 'on';
  look?: 'glass' | 'paper';
  formatBar?: boolean;
  ocr?: boolean;
  asr?: boolean;   // voice notes transcribed on the device
  audioRate?: number;
  collections?: Collection[];
  recentSearches?: string[];
  hintsSeen?: string[];
  lastBackup?: number;
  firstRun?: number;
  onboarded?: number;
  pinnedFolded?: boolean;   // the Épinglées shelf is folded away
  seenVersion?: string;
  iosInstallDismissed?: boolean;
}

export type SheetMode = 'study' | 'map' | 'overview' | 'settings' | 'about' | 'news' | 'guide';
export type LayerMode =
  | 'create' | 'note-menu' | 'import' | 'list-actions' | 'ios-install' | 'picker'
  | 'pin' | 'remind' | 'history' | 'sel-more' | 'outline' | 'sort';
export type PinStep = 'new' | 'auth' | 'change';

export interface StudyItem { noteId: number; card: Flashcard }
export interface Flashcard { q: string; a: string; line: number; key: string }

export interface Layer {
  mode: LayerMode | null;
  newFolder: boolean;
  editFolders: boolean;
  renaming: string | null;
  coloring: string | null;
  pinStep: PinStep | null;
  resetArmed: boolean;
}

export interface Toast { id: number; message: string; label: string; action: (() => void) | null; kind?: ChangeKind }
/** One voice for state marks: new (amber), fix (red), better / on (green). */
export type ChangeKind = 'new' | 'fix' | 'better';
