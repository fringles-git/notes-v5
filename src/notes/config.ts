import type { ChangeKind, Prefs } from './types';

/** Tunables — one place for every magic number. */
export const CONFIG = {
  pageSize: 60,
  saveDelay: 300,
  toastMs: 5000,
  trashDays: 30,
  versionsMax: 10,
  attWarnBytes: 25e6,
  longPressMs: 450,
  holdMs: 280,            // holding + opens Créer under the finger, ready to slide
  resumeMs: 2 * 36e5,     // a note edited this recently is offered as "Reprendre"
  shareLinkMax: 8000,     // longest note link, in characters, before falling back to text
  swipeStart: 12,
  swipeMax: 96,
  pullToSearch: 72,
  editorDragClose: 96,
  sheetDragClose: 96,     // pulling a sheet down by its handle this far closes it
  backupNagDays: 14,
  ocrMaxSide: 2000,
  reminderPollMs: 30000,
  studyBoxes: [0, 1, 3, 7, 14, 30],
  audioRates: [1, 1.25, 1.5, 2],
  wavePeaks: 28,
  splitMedia: '(min-width:64em)',
  wideMedia: '(min-width:40em) and (min-height:30em)',   // same as the tablet rules in app.css
} as const;

export const DAY = 864e5;

export const DEFAULT_FOLDERS = ['Idées', 'Travail', 'Personnel'];
export const FOLDER_COLORS = ['bleu', 'orange', 'vert', 'violet', 'rose', 'turquoise', 'brun', 'gris'];

export const DEFAULT_PREFS: Prefs = {
  tab: 'all', view: 'cards', sort: 'updated', dir: 'desc',
  theme: 'auto', hand: 'right', tint: 'off',
};

/* Smart views shown in the Library and the search filter chips */
export const KINDS = ['week', 'study', 'lists', 'dated', 'links', 'photos', 'audio', 'pdfs'] as const;
export const SEARCH_KINDS = ['photos', 'audio', 'pdfs', 'lists', 'links', 'dated'] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_ICON: Record<string, string> = {
  photos: 'image', audio: 'audio', pdfs: 'doc', lists: 'checklist', links: 'link', dated: 'calendar', week: 'history', study: 'study',
  all: 'all', none: 'folder', locked: 'lock', trash: 'trash',
};

export const TAB_LABEL: Record<string, string> = {
  all: 'Toutes les notes', week: 'Cette semaine', lists: 'Listes', dated: 'Avec une date', links: 'Liens', photos: 'Photos',
  audio: 'Notes vocales', pdfs: 'PDF', study: 'À réviser', none: 'Sans dossier', trash: 'Corbeille', locked: 'Notes masquées',
};

/** What an empty note can become (¦ = caret). Shown in the note, under the placeholder, while it is empty. */
export const TEMPLATES = [
  { id: 'list', label: 'Liste', icon: 'checklist', title: () => '', body: '- [ ] ¦' },
  { id: 'card', label: 'Carte à réviser', icon: 'study', title: () => '', body: '¦ :: ' },
  {
    id: 'meeting', label: 'Réunion', icon: 'all', title: (d: Date) => 'Réunion du ' + d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
    body: '## Participants\n- ¦\n\n## Ordre du jour\n1. \n\n## Décisions\n- \n\n## Actions\n- [ ] ',
  },
  { id: 'project', label: 'Projet', icon: 'outline', title: () => '', body: '## Objectif\n¦\n\n## Étapes\n- [ ] \n\n## Notes\n' },
  { id: 'study', label: 'Fiche de révision', icon: 'doc', title: () => '', body: '## Points clés\n- ¦\n\n## Cartes\nQuestion :: Réponse' },
  {
    id: 'today', label: 'Journal du jour', icon: 'calendar', body: '#journal\n\n¦',
    title: (d: Date) => { const t = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); return t[0].toUpperCase() + t.slice(1); },
  },
] as const;

/** One tip at a time on the home screen. `fine`: mouse and keyboard only; `touch`: touch screens only. */
export const HINTS: { id: string; text: string; fine?: boolean; touch?: boolean }[] = [
  { id: 'select', text: 'Appui long sur une note pour en sélectionner plusieurs', touch: true },
  { id: 'select-key', text: 'Touche S pour sélectionner plusieurs notes', fine: true },
  { id: 'swipe', text: 'Glissez une note pour l’épingler ou la supprimer', touch: true },
  { id: 'paste', text: 'Collez une image ou un lien pour en faire une note', fine: true },
  { id: 'links', text: 'Écrivez [[Titre]] pour relier deux notes' },
  { id: 'cards', text: 'Écrivez « Question :: Réponse » pour créer une carte à réviser' },
  { id: 'hidden', text: '⋮ → Masquer range une note dans Notes masquées' },
];

/** The guided tour: one short line per tool, beside it. */
export const TOUR = [
  { target: '#fab', title: 'Créer', text: '**+** : **Note**, **Vocal** ou **Importer**. Une note vide propose liste, réunion, carte à réviser…', hints: ['paste'] },
  { target: '#nav-island', title: 'Naviguer', text: '**Notes**, **Bibliothèque** (dossiers, étiquettes), **Recherche** et **Réglages**.', hints: ['hidden'] },
  { target: '#view-tools', title: 'Affichage', text: '**Cartes ou liste compacte**, et **trier**.', hints: [] },
  { target: '#note-list .card', title: 'Vos notes', text: 'Glissez à droite pour épingler, à gauche pour supprimer ; **appui long** (ou **S**) pour en choisir plusieurs.', hints: ['select', 'swipe'] },
  { target: null, title: 'Dans une note', text: 'En bas : **Aa** met en forme, **📎** joint un fichier, **✓** termine. Glissez la note vers le bas pour la fermer.', hints: ['links', 'cards'] },
];

/* ---------- Changelog: the releases live in changelog.ts, loaded only by the sheets that show them ---------- */
/** The installed version (newest release), set at build time from changelog.ts so startup never loads the changelog. */
export const VERSION: string = __VERSION__;
export const CHANGE_KINDS = [
  { kind: 'new', title: 'Nouveau', one: 'nouveauté', many: 'nouveautés', icon: 'sparkle' },
  { kind: 'fix', title: 'Corrections', one: 'correction', many: 'corrections', icon: 'bug' },
  { kind: 'better', title: 'Améliorations', one: 'amélioration', many: 'améliorations', icon: 'improve' },
] as const;

export const MSG = {
  trashed: 'Note placée dans la corbeille',
  folderExists: 'Ce dossier existe déjà.',
  badBackup: 'Fichier illisible : choisissez une sauvegarde .json exportée depuis Notes.',
} as const;
