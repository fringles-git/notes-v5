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

/** Semantic tones (system colors): same meaning everywhere — red records & deletes, orange dates, green photos… */
export const KIND_TONE: Record<string, string> = {
  all: 'gray', week: 'purple', study: 'indigo', lists: 'blue', dated: 'orange', links: 'teal', photos: 'green',
  audio: 'pink', pdfs: 'red', none: 'gray', locked: 'gray', trash: 'red', map: 'teal',
};

export const TAB_LABEL: Record<string, string> = {
  all: 'Toutes les notes', week: 'Cette semaine', lists: 'Listes', dated: 'Avec une date', links: 'Liens', photos: 'Photos',
  audio: 'Notes vocales', pdfs: 'PDF', study: 'À réviser', none: 'Sans dossier', trash: 'Corbeille', locked: 'Notes masquées',
};

/** What an empty note can become (¦ = caret). Shown in the note, under the placeholder, while it is empty. */
export const TEMPLATES = [
  { id: 'list', label: 'Liste', icon: 'checklist', tone: 'blue', title: () => '', body: '- [ ] ¦' },
  { id: 'card', label: 'Carte à réviser', icon: 'study', tone: 'indigo', title: () => '', body: '¦ :: ' },
  {
    id: 'meeting', label: 'Réunion', icon: 'all', tone: 'orange', title: (d: Date) => 'Réunion du ' + d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
    body: '## Participants\n- ¦\n\n## Ordre du jour\n1. \n\n## Décisions\n- \n\n## Actions\n- [ ] ',
  },
  { id: 'project', label: 'Projet', icon: 'outline', tone: 'teal', title: () => '', body: '## Objectif\n¦\n\n## Étapes\n- [ ] \n\n## Notes\n' },
  { id: 'study', label: 'Fiche de révision', icon: 'doc', tone: 'purple', title: () => '', body: '## Points clés\n- ¦\n\n## Cartes\nQuestion :: Réponse' },
  {
    id: 'today', label: 'Journal du jour', icon: 'calendar', tone: 'green', body: '#journal\n\n¦',
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

export const CREDITS: [string, string][] = [
  ['Figtree', 'police · SIL Open Font License'],
  ['pdf.js', 'lecture des PDF · Apache 2.0'],
  ['Tesseract.js', 'texte des photos · Apache 2.0'],
  ['Transformers.js, ONNX Runtime, Whisper', 'texte des notes vocales · Apache 2.0, MIT'],
  ['PptxGenJS', 'export PowerPoint · MIT'],
  ['React, Zustand', 'interface · MIT'],
];

/* ---------- Changelog (newest first; calendar versions YY.M.D.n) ---------- */
export const CHANGE_KINDS = [
  { kind: 'new', title: 'Nouveau', one: 'nouveauté', many: 'nouveautés', icon: 'sparkle' },
  { kind: 'fix', title: 'Corrections', one: 'correction', many: 'corrections', icon: 'bug' },
  { kind: 'better', title: 'Améliorations', one: 'amélioration', many: 'améliorations', icon: 'improve' },
] as const;
export interface Release { date: string; legacy?: string; changes: Partial<Record<ChangeKind, string[]>>; version: string }

const RELEASES: Omit<Release, 'version'>[] = [
  {
    date: '2026-10-21',
    changes: {
      new: [
        'Premier lancement sans notes d’exemple : l’accueil propose Note, Liste, Vocal ou Importer, et le guide se lit dans Réglages › Aide',
        'Épinglées en tête de la liste, repliables d’un geste',
        'À la souris : épingler, déplacer ou supprimer une note sans ouvrir son menu',
        'Au clavier : ⌘K ou / cherche, N crée une note — rappelés dans la recherche',
      ],
      better: [
        'Téléphone : une note par ligne, le texte se lit en lignes entières ; la vue liste devient compacte (titre, date, une ligne)',
        'Tablette et ordinateur : la grille remplit l’écran ; à côté d’une note, la liste garde une colonne lisible',
        'Éditeur : une seule barre en bas ; Aa y remplace les outils par la mise en forme',
        'Une note vide propose ses modèles dans la note même, sous « Écrire quelque chose… » ; ils partent à la première lettre',
        '« Enregistré » s’affiche un instant en haut de la note, puis s’efface',
        'Réglages, À propos et Quoi de neuf : de vraies feuilles venues du bas, avec une poignée pour les tirer vers le bas',
        'Sur tablette, les panneaux descendent jusqu’en bas et la barre se range à côté',
        'Les messages s’affichent en haut : plus rien ne s’empile sur les barres du bas',
        'Fond uni, cartes pleines, sans ombres : le texte se détache ; le fond coloré reste pour l’accueil',
        'Une seule échelle de texte ; textes secondaires et onglets plus lisibles',
        'L’ambre est réservé à la création et aux notes épinglées ; le contour du focus est sombre et se voit partout',
        'Récap : « À faire » compte les tâches restantes ; sur téléphone, il tient sur une ligne qui défile',
        'Le dossier d’une note se voit sur sa carte, par un liseré de sa couleur',
        'Bibliothèque plus calme : moins de contours et d’ombres',
        'Contraste renforcé quand l’appareil le demande',
      ],
      fix: [
        'Plus de « … » isolé au-dessus de la barre de progression : le texte s’estompe',
        'Quoi de neuf ne répète plus la version et ses compteurs',
        'Bannière « Tirez la liste vers le bas » retirée ; les astuces tactiles ne s’affichent plus à la souris',
        'La barre du bas ne saute plus quand la barre d’adresse du navigateur apparaît',
      ],
    },
  },
  {
    date: '2026-10-19',
    changes: {
      new: [
        'Notes masquées chiffrées sur l’appareil : texte, photos et versions ne se lisent qu’avec votre code PIN',
        'Face ID ou empreinte ouvre les notes masquées, là où l’appareil le permet (Réglages › Notes masquées)',
        'Texte des notes vocales : transcrites sur l’appareil, elles se retrouvent dans la recherche (Réglages › Recherche)',
        'Ajouter la transcription : sur un enregistrement, ses mots vont dans la note',
      ],
      better: [
        'Une note vocale prend pour titre ses premiers mots',
      ],
    },
  },
  {
    date: '2026-10-19',
    changes: {
      new: [
        'Glisser depuis + : appuyez, glissez sur Note, Vocal ou Importer, relâchez — c’est créé',
        'Ajouter le texte : les mots d’une photo ou d’un PDF vont dans la note, en un geste',
        'Reprendre : la note que vous veniez d’écrire revient en tête de l’accueil',
        'Envoyer un lien : une note voyage dans un lien, sans serveur ni compte',
        'Exporter en Markdown (.zip) : dossiers et pièces jointes, prêts pour Obsidian',
        'Raccourci « Note vocale » sur l’icône de l’app, et une pastille pour les cartes à réviser et les rappels du jour',
      ],
    },
  },
  {
    date: '2026-10-19',
    changes: {
      better: [
        'Titres de section en minuscules, comme les titres de la liste : plus lisibles, plus de capitales',
        'La visite guidée signale la touche S',
      ],
    },
  },
  {
    date: '2026-10-19',
    changes: {
      new: [
        'Touche S : sélectionner plusieurs notes au clavier (Espace coche, Échap termine)',
      ],
      better: [
        'Pastilles et puces se touchent plus facilement (44 px), sans grossir à l’écran',
        'Carte des liens : les points de dossier sont carrés, comme partout ailleurs',
      ],
    },
  },
  {
    date: '2026-10-19',
    changes: {
      fix: [
        'Dans la Bibliothèque, « Toutes les notes » ne paraît plus choisie quand rien n’est filtré',
        'À la première visite, l’app ne se recharge plus d’elle-même en se préparant pour le hors-ligne',
      ],
    },
  },
  {
    date: '2026-10-19',
    changes: {
      new: [
        'Sur tablette, Plan et Historique s’ouvrent à côté de la note sans la couvrir : on continue d’écrire, le plan reste ouvert',
        'Clic droit sur une note, à la souris : son menu',
        'Alt + ↑ / ↓ sur une note épinglée la monte ou la descend',
      ],
      better: [
        'La barre du bas glisse d’un onglet à l’autre, comme les choix des Réglages',
        'Numéros de version, étiquettes et points suivent la règle ÷3 : plus aucune forme ronde',
        'Une seule police, Figtree, pour l’interface et les notes',
        'Les notes Bienvenue et Comment utiliser jamais modifiées suivent le texte à jour',
        'Au lancement, le fond suit le thème clair ou sombre avant même l’affichage',
      ],
    },
  },
  {
    date: '2026-10-19',
    changes: {
      new: [
        'La Bibliothèque est une page comme la liste : son titre, la barre du bas reste ; un dossier ouvert revient à la Bibliothèque',
        'Réglages → Aide : visite guidée, guide d’utilisation et Quoi de neuf, à revoir quand vous voulez',
        'Police des notes au choix : Figtree ou Literata',
      ],
      better: [
        'La barre du bas ne disparaît plus : + devient ✕ et referme le menu, les onglets restent utilisables',
        'Créer : Importer, Vocal, Note (le plus près du pouce), icônes au trait dans leur couleur, sans légende',
        'Survol, appui et sélection animés de la même façon partout ; un choix se montre teinté et cerclé, jamais en noir',
        'Recherche : plus de « Tout », un filtre se retire en le touchant à nouveau',
        'Interrupteurs carrés avec ✓ ou −, comme le reste de l’interface ; nouveautés, corrections et améliorations marquées pareil partout',
        'Sur tablette, Réglages, À propos et Quoi de neuf s’ouvrent sur le côté du pouce ; l’accueil reste au centre',
        'Thème sombre : la barre du bas retrouve son verre sombre',
      ],
      fix: [
        'Dans une carte, les titres du texte ne dépassent plus le titre de la note',
        'Noms alignés : Corbeille, Sans dossier, Toutes les notes',
        'Le stockage se protège seul à l’installation et à chaque export',
      ],
    },
  },
  {
    date: '2026-10-19',
    changes: {
      new: [
        'Tablette, liste et note côte à côte : chaque volet garde ses îlots dans son coin, la navigation et + en bas à gauche, les outils de la note en bas à droite',
        'Le dossier de la note s’affiche au-dessus du titre : touchez-le pour la déplacer',
        'Plan, Historique et Vue d’ensemble s’ouvrent en panneau sur le côté du pouce, la note reste visible',
        'Réviser et Carte des liens s’ouvrent en plein écran',
      ],
      better: [
        'Le texte s’efface en douceur sous les outils au lieu de passer derrière',
        'Les menus laissent visible le bouton qui les a ouverts',
        'Les colonnes suivent la largeur du volet : deux à côté d’une note, trois en pleine largeur',
        'Téléphone à l’horizontale : mise en forme et outils sur une seule ligne',
        'Créer : icône, nom et détail alignés dans les trois choix, Note en jaune avec un crayon sombre',
        'Textes secondaires et coches ambrées plus lisibles en thème clair',
        'Recherche, messages et enregistrement se rangent du côté du pouce sur tablette',
      ],
      fix: [
        'Réduire la transparence et réduire les animations sont respectés partout',
        'Rien ne passe sous l’encoche d’un téléphone à l’horizontale',
        'Les cases à cocher des cartes sont plus faciles à toucher',
        'Supprimer, dans la sélection, retrouve un rouge lisible',
      ],
    },
  },
  {
    date: '2026-10-18',
    changes: {
      new: [
        'Note du jour dans Créer : rouvre celle d’aujourd’hui si elle existe',
        'Sous le titre d’une note : Plan, cartes à réviser et carte des liens en un geste',
      ],
      better: [
        'Les listes affichent une barre de progression sur leur carte',
        'Restaurer une version indique sa date',
      ],
    },
  },
  {
    date: '2026-10-18',
    changes: {
      better: [
        'Trier s’ouvre en liste déroulante sous le bouton, la page reste nette derrière',
        'En thème sombre, les barres sont en verre clair au lieu d’un bloc noir',
        'Filtrer retiré : la Recherche et la Bibliothèque filtrent déjà par photos, listes, dates…',
      ],
    },
  },
  {
    date: '2026-10-18',
    changes: {
      new: [
        '+ propose trois choix : Note, Vocal, Importer',
        'Une note vide propose : liste, carte à réviser, réunion, projet, fiche, journal du jour',
        'En haut : cartes ou liste et trier, en menu déroulant sous le bouton',
      ],
      better: [
        'Une seule barre en bas : Notes, Bibliothèque, Recherche, Réglages, avec + du côté de la main dominante ; regroupée de ce côté sur tablette',
        'Récap en mosaïque, fond flouté derrière les menus, barre de navigation plus lisible, trois colonnes de cartes sur tablette',
        'Guide « Comment utiliser » réécrit : raccourcis clairs, Entrée pour ajouter un élément à la liste',
      ],
    },
  },
  {
    date: '2026-10-18',
    changes: {
      new: [
        'Récap en haut de l’accueil : à venir, à réviser, à faire, photo récente, souvenir',
        'Bibliothèque en pleine page : vues en tuiles, dossiers illustrés, nuage d’étiquettes',
        'Couleurs système avec un sens fixe : rouge pour le micro et la suppression, orange pour les dates, vert pour les photos…',
      ],
      better: [
        'Sur tablette : cartes plus grandes, vue liste sur deux colonnes, menus ouverts à côté du bouton qui les appelle',
        'Interrupteurs et sélecteurs qui glissent ; petites animations aux coches et aux choix',
        'Sélection plus compacte ; les compteurs à zéro sont masqués',
      ],
      fix: ['La page se met à jour au rechargement, sans rester sur l’ancienne version'],
    },
  },
  {
    date: '2026-10-18',
    changes: {
      new: [
        'Verre liquide : îlots flottants translucides sur un fond calme',
        'Deux îlots au pouce : Bibliothèque et Réglages d’un côté ; Recherche, micro et + de l’autre, inversés pour les gauchers',
        'Le + crée une note en une touche ; appui long pour liste, photo, modèles et import',
        'La recherche s’ouvre en bas, au-dessus du clavier ; tirer la liste vers le bas la lance aussi',
      ],
      better: [
        'Éditeur : toutes les actions en bas (Aa, liste, trombone, ⋮, ✓), glisser vers le bas pour fermer',
        'Menus en feuilles venues du bas, du côté du pouce',
      ],
      fix: [
        'Le mode gaucher inverse à nouveau toutes les barres et tous les menus',
        'Plus aucune action fréquente dans le coin haut de l’écran',
      ],
    },
  },
  {
    date: '2026-10-15',
    changes: {
      new: [
        'Navigation en bas : Notes, Recherche, Bibliothèque et Réglages, avec le + à côté',
        'Le + crée une note texte, une liste, une photo ou un message vocal en un geste',
        'La recherche devient une page : notes récentes par jour, filtres, résultats dès la première lettre',
        '⋮ sur chaque note : épingler, déplacer, partager, masquer, supprimer',
      ],
      better: [
        'Éditeur presque sans boutons',
        'Cartes plus calmes : titre, date et dossier, le texte, puis des compteurs discrets',
        'Gestes réduits à trois : glisser à droite pour épingler, à gauche pour supprimer, appui long pour sélectionner',
      ],
    },
  },
  {
    date: '2026-10-09',
    changes: {
      new: [
        'Étiquettes : un mot précédé de # range la note sous cette étiquette',
        'Collections : une recherche enregistrée, à côté des dossiers',
        'Modèles (liste, réunion, projet, fiche de révision) et note du jour',
        'Importer Markdown, texte, web, un dossier (Obsidian) ou un livre EPUB',
        'Texte dans les photos : lu sur l’appareil, trouvé par la recherche',
        'Exporter un dossier en présentation PowerPoint',
      ],
    },
  },
  { date: '2026-10-09', changes: { new: ['Numéros de version datés : année.mois.jour.n'] } },
  { date: '2026-10-09', legacy: '2.2.0', changes: { new: ['Quoi de neuf après une mise à jour', 'Journal des modifications en frise'] } },
  {
    date: '2026-10-09', legacy: '2.1.0',
    changes: { new: ['Bouton Aa : titres, gras, italique, surligné, listes, liens entre notes', 'Accueil, visite guidée et panneau À propos'] },
  },
  {
    date: '2026-10-09', legacy: '2.0.0',
    changes: {
      new: ['Installable et utilisable hors ligne', 'Partager → Notes depuis les autres apps', 'Rappel de sauvegarde après deux semaines'],
      fix: ['Enregistrement vocal sur iPhone'],
      better: ['Application reconstruite (React, TypeScript)', 'Code PIN renforcé'],
    },
  },
  { date: '2026-10', legacy: '1.3', changes: { new: ['Cartes de révision, carte des liens [[ ]], vue d’ensemble d’un dossier'] } },
  { date: '2026-10', legacy: '1.2', changes: { new: ['Dates, adresses, numéros et liens deviennent des boutons', 'Rappels, historique, messages vocaux'] } },
  { date: '2026-10', legacy: '1.1', changes: { better: ['Design system Notes : îlots au pouce, thème sombre, couleurs de dossiers'] } },
  { date: '2026-09', legacy: '1.0', changes: { new: ['Première version : notes, listes, dossiers, recherche, photos, corbeille'] } },
];

export const RELEASE_LIST: Release[] = RELEASES.map((r, i) => {
  const [y, m, d] = r.date.split('-').map(Number);
  const n = RELEASES.slice(i).filter(o => o.date === r.date).length;
  return { ...r, version: d ? `${y % 100}.${m}.${d}.${n}` : r.legacy! };
});
export const CURRENT = RELEASE_LIST[0];
export const findRelease = (v: string) => RELEASE_LIST.find(r => r.version === v || r.legacy === v);
export const releasesSince = (v: string) => {
  const r = findRelease(v);
  return r ? RELEASE_LIST.slice(0, RELEASE_LIST.indexOf(r)) : [];
};

/* ---------- Guide (Réglages › Aide), read in a sheet: the workspace holds only the user's notes ---------- */
export const GUIDE = `# Créer
- **+** : **Note**, **Vocal** ou **Importer** (photo, PDF, Markdown, EPUB) — ou appuyez sur **+** et glissez jusqu’au choix
- Note vide : choisissez **Liste**, **Carte à réviser**, **Réunion**, **Projet** ou **Journal du jour**
- Collez une image ou un lien sur l’accueil : il devient une note

# Mettre en forme
Touchez le texte pour l’écrire ; il se met en forme quand vous sortez. **Aa**, en bas de la note, ouvre les outils :
- **H** titre (touchez encore : sous-titre, intertitre)
- **B** gras, **I** italique, surligneur ==surligné==
- Listes à puces, numérotées ou à cocher
- Un titre entre doubles crochets : lien vers une autre note, comme [[Idées de voyage]]
- **::** carte à réviser

**Entrée** ajoute un élément à la liste ; **Entrée** sur un élément vide termine la liste.

# Raccourcis clavier
Ctrl sur Windows, ⌘ sur Mac :
- Ctrl + B : gras · Ctrl + I : italique · Ctrl + Maj + H : surligner
- Ctrl + Maj + 7 / 8 / 9 : liste numérotée / à puces / à cocher
- Ctrl + K : lien · Ctrl + Maj + K : carte à réviser
- Ctrl + Alt + 1 / 2 / 3 : titres
- Sur l’accueil : **N** note, **L** liste, **D** journal du jour, **/** ou **Ctrl + K** rechercher, **S** sélectionner (Espace coche une note, Échap termine)
- **Alt + ↑ / ↓** sur une note épinglée : la monter ou la descendre

# Organiser
- Glissez une note à droite : **épingler** ; à gauche : **supprimer**
- **Appui long**, ou **S** au clavier : sélectionner plusieurs notes (déplacer, fusionner, partager)
- À la souris, survolez une note : **épingler**, **déplacer**, **supprimer** ; **clic droit** : son menu
- Les notes épinglées restent en tête ; touchez **Épinglées** pour les replier
- **⋮** sur une note : épingler, déplacer, rappel, partager, masquer
- **Bibliothèque** : dossiers en couleur, #étiquettes, collections, Notes masquées (chiffrées, code PIN ou Face ID / empreinte), corbeille

# Retrouver
**Recherche** lit aussi le texte des PDF, des photos et des notes vocales ; **Ajouter le texte**, sur une photo, un PDF ou un enregistrement, le met dans la note. **Enregistrer** garde une recherche comme collection. En haut de l’accueil : cartes ou liste, et trier.

# Réviser
Une ligne « Question :: Réponse » devient une carte. **⋮ → Réviser** vous interroge au bon moment.

# Sauvegarder
Rien n’est envoyé sur le cloud : exportez parfois une sauvegarde (**Réglages → Exporter les notes**), ou tout en Markdown pour Obsidian. **⋮ → Envoyer un lien** partage une note sans serveur. Chaque note garde ses 10 dernières versions.

Ajoutez Notes à l’écran d’accueil : elle s’ouvre comme une app, et le navigateur ne peut plus effacer vos notes.`;

export const MSG = {
  trashed: 'Note placée dans la corbeille',
  folderExists: 'Ce dossier existe déjà.',
  badBackup: 'Fichier illisible : choisissez une sauvegarde .json exportée depuis Notes.',
} as const;
