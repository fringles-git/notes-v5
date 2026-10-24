/** Full sheets: study, link map, overview, settings, about, what's new — plus toast and print area. */
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import type { Note, SheetMode } from '../types';
import { VERSION } from '../config';
import { backlinks, dueCards, entities, flashcards, hostOf, masteredCount, nextDue, titleIndex, withScheme } from '../markdown';
import { urlOf } from '../media';
import { folderColor, noteById, readableNotes, tabFolder, tabLabel, tabNotes, useStore } from '../store';
import { changePin, closeSheet, open, openLink, openSheet, runToastAction, toggleDeviceUnlock } from '../actions';
import { deviceAvailable } from '../vault';
import {
  answer, deleteCard, exportBackup, exportMarkdown, exportSlides, exportVault, install, lastBackupLabel, openGuide, openNews, printTab,
  retryMissed, reveal, startStudy, startTour, studyNotes, toggleAsr, toggleOcr, openMap,
} from '../features';
import { clock, day, dayTime, plural } from '../utils';
import { ACCENTS, Chip, Formatted, HANDS, LOOKS, Layer, Row, Section, Segmented, StateMark, Switch, THEMES } from './kit';
import { Icon } from './icons';
import { pickFile } from './Files';

const Empty = ({ title, hint }: { title: string; hint?: string }) => <div className="sheet-empty"><p>{title}</p>{hint && <p className="layer-hint">{hint}</p>}</div>;
const Btn = ({ label, onClick, primary = false }: { label: string; onClick: () => void; primary?: boolean }) =>
  <button className={'ctl is-l ' + (primary ? 'is-ink' : 'is-fill-strong')} onClick={onClick}>{label}</button>;

/* ---------- Study ---------- */
function Study() {
  const s = useStore(s => s.study), total = s.queue.length, item = s.queue[s.index];
  if (!total) {
    const notes = studyNotes(), cards = notes.flatMap(n => flashcards(n.body)).length;
    return cards
      ? <Empty title="Tout est revu." hint={`${plural(cards, 'carte', 'cartes')}, ${masteredCount(notes)} maîtrisées. Prochaine révision : ${day(nextDue(notes))}.`} />
      : <Empty title="Aucune carte." hint="Écrivez une question et sa réponse sur une ligne, séparées par « :: ». Par exemple : Capitale du Canada :: Ottawa" />;
  }
  if (!item) {
    const notes = studyNotes(), cards = notes.flatMap(n => flashcards(n.body)).length;
    return (
      <>
        <Empty title="Session terminée." hint={`${plural(s.firstTry + s.missed.size, 'carte revue', 'cartes revues')} : ${s.firstTry} du premier coup, ${s.missed.size} à revoir. ${masteredCount(notes)} sur ${cards} maîtrisées.`} />
        <Section title="À revoir" show={s.missed.size > 0}>
          <ul className="study-missed">{[...s.missed].map(m => <li key={m.noteId + m.card.key}><b>{m.card.q}</b><span>{m.card.a}</span></li>)}</ul>
        </Section>
      </>
    );
  }
  return (
    <>
      <div className="study-progress" role="progressbar" aria-label="Progression de la révision" aria-valuemin={0} aria-valuemax={total} aria-valuenow={s.index}>
        <span className="progress-track"><span className="progress-fill" style={{ '--progress': Math.round((s.index / total) * 100) + '%' } as React.CSSProperties} /></span>
        <span>{s.index + 1} / {total}</span>
      </div>
      <button className={'flashcard glass' + (s.revealed ? ' is-revealed' : '')} onClick={reveal} aria-disabled={s.revealed || undefined}>
        <span className="flashcard-q">{item.card.q}</span>
        {s.revealed ? <span className="flashcard-a" aria-live="polite">{item.card.a}</span> : <span className="flashcard-hint">Touchez pour voir la réponse</span>}
        <span className="flashcard-source">{noteById(item.noteId)?.title || 'Sans titre'}</span>
      </button>
      <button className="ctl is-muted study-delete" onClick={deleteCard}>Supprimer la carte</button>
    </>
  );
}
function StudyFoot() {
  const s = useStore(s => s.study), item = s.queue[s.index];
  if (!s.queue.length) return nextDue(studyNotes()) ? <Btn primary label="Réviser toutes les cartes" onClick={() => startStudy(studyNotes(), true)} /> : <Btn primary label="Fermer" onClick={closeSheet} />;
  if (!item) return <>{s.missed.size ? <Btn label={`Revoir (${s.missed.size})`} onClick={retryMissed} /> : <Btn label="Recommencer" onClick={() => startStudy(studyNotes(), true)} />}<Btn primary label="Terminer" onClick={closeSheet} /></>;
  return s.revealed ? <><Btn label="À revoir" onClick={() => answer(false)} /><Btn primary label="Je savais" onClick={() => answer(true)} /></> : <Btn primary label="Voir la réponse" onClick={reveal} />;
}

/* ---------- Link map (force layout) ---------- */
type MapNode = { note?: Note; ghost?: string; label: string };
function graph(notes: Note[], center: Note | null, pool: Note[]) {
  const byTitle = titleIndex(notes), find = (t: string) => byTitle.get(t.toLowerCase());
  let picked: Note[];
  if (center) {
    const set = new Set([center]);
    for (let hop = 0; hop < 2; hop++) [...set].forEach(n => { entities(n).links.map(find).forEach(x => x && set.add(x)); backlinks(n, notes).forEach(x => set.add(x)); });
    picked = [...set];
  } else picked = pool.filter(n => entities(n).links.length || backlinks(n, notes).length);
  picked = picked.slice(0, 120);
  const nodes = new Map<string, MapNode>(), edges = new Map<string, [string, string]>();
  const add = (k: string, v: MapNode) => { if (!nodes.has(k)) nodes.set(k, v); return k; };
  picked.forEach(n => add('n' + n.id, { note: n, label: n.title || 'Sans titre' }));
  picked.forEach(n => entities(n).links.forEach(t => {
    const target = find(t), from = 'n' + n.id;
    if (target && !nodes.has('n' + target.id) && nodes.size >= 120) return;
    const to = target ? add('n' + target.id, { note: target, label: target.title }) : add('t' + t.toLowerCase(), { ghost: t, label: t });
    if (to !== from) edges.set([from, to].sort().join('|'), [from, to]);
  }));
  return { nodes, edges: [...edges.values()], center: center ? 'n' + center.id : null };
}
function layout({ nodes, edges, center }: ReturnType<typeof graph>) {
  const keys = [...nodes.keys()], n = keys.length, pos = new Map<string, { x: number; y: number }>();
  keys.forEach((k, i) => { const a = (2 * Math.PI * i) / n, r = k === center ? 0 : (150 * Math.sqrt(n)) / 2; pos.set(k, { x: Math.cos(a) * r, y: Math.sin(a) * r }); });
  for (let it = 0, heat = 150; it < 300; it++, heat *= 0.985) {
    const f = new Map(keys.map(k => [k, { x: 0, y: 0 }]));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = pos.get(keys[i])!, b = pos.get(keys[j])!, dx = a.x - b.x, dy = (a.y - b.y) * 1.6, d = Math.max(1, Math.hypot(dx, dy)), k = 22500 / d / d;
      f.get(keys[i])!.x += dx * k; f.get(keys[i])!.y += dy * k; f.get(keys[j])!.x -= dx * k; f.get(keys[j])!.y -= dy * k;
    }
    edges.forEach(([a, b]) => {
      const p = pos.get(a)!, q = pos.get(b)!, dx = p.x - q.x, dy = p.y - q.y, k = Math.max(1, Math.hypot(dx, dy)) / 150;
      f.get(a)!.x -= dx * k; f.get(a)!.y -= dy * k; f.get(b)!.x += dx * k; f.get(b)!.y += dy * k;
    });
    keys.forEach(k => {
      if (k === center) return;
      const p = pos.get(k)!, v = f.get(k)!;
      v.x -= 0.05 * p.x; v.y -= 0.05 * p.y;
      const len = Math.max(1, Math.hypot(v.x, v.y)), step = Math.min(len, heat);
      p.x += (v.x / len) * step; p.y += (v.y / len) * step;
    });
  }
  return pos;
}
function LinkMap() {
  const s = useStore(useShallow(s => ({ center: s.mapCenter, tab: s.prefs.tab, colors: s.folderColors, readable: readableNotes(s) })));
  const box = useRef<HTMLDivElement>(null), folder = tabFolder(s.tab), center = s.center === null ? null : noteById(s.center) || null;
  const g = graph(s.readable, center, s.readable.filter(n => !folder || n.folder === folder));
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const target = (el.querySelector('.is-center rect') || el.querySelector('svg'))!, r = el.getBoundingClientRect(), t = target.getBoundingClientRect();
    el.scrollLeft += t.left + t.width / 2 - r.left - r.width / 2;
    el.scrollTop += t.top + t.height / 2 - r.top - r.height / 2;
  }, [s.center]);
  if (g.nodes.size < 2 && !g.edges.length) return <Empty title="Aucun lien pour l’instant." hint="Écrivez [[Titre d’une note]] dans une note pour relier les deux. Les liens apparaissent ici." />;
  const pos = layout(g), width = (l: string) => 28 + 7.6 * Math.min(l.length, 24), nodes = [...g.nodes];
  const xs = nodes.map(([k, v]) => [pos.get(k)!.x - width(v.label) / 2, pos.get(k)!.x + width(v.label) / 2]), ys = [...pos.values()].map(p => p.y);
  const x0 = Math.min(...xs.map(x => x[0])) - 24, x1 = Math.max(...xs.map(x => x[1])) + 24, y0 = Math.min(...ys) - 42, y1 = Math.max(...ys) + 42;
  const go = (n: MapNode) => { closeSheet(); if (n.ghost) openLink(n.ghost); else open(n.note!.id); };
  return (
    <>
      <div className="map-canvas" ref={box}>
        <svg className="link-map" style={{ width: x1 - x0, height: y1 - y0 }} viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} role="group" aria-label={'Carte des liens : ' + plural(g.nodes.size, 'note', 'notes')}>
          <g className="map-edges">{g.edges.map(([a, b]) => { const p = pos.get(a)!, q = pos.get(b)!; return <line key={a + b} x1={p.x} y1={p.y} x2={q.x} y2={q.y} />; })}</g>
          {nodes.map(([k, v]) => {
            const p = pos.get(k)!, w = width(v.label), color = v.note?.folder ? folderColor(v.note.folder, s.colors) : undefined;
            return (
              <g key={k} className={'map-node' + (v.ghost ? ' is-ghost' : '') + (k === g.center ? ' is-center' : '')} data-color={color} role="button" tabIndex={0}
                aria-label={(v.ghost ? 'Créer la note ' : 'Ouvrir la note ') + v.label} transform={`translate(${p.x - w / 2},${p.y - 18})`}
                onClick={() => go(v)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(v); } }}>
                <rect width={w} height={36} rx={12} />
                {color && <rect className="map-dot" x={10} y={14} width={8} height={8} rx={8 / 3} />}
                <text x={color ? 24 : 14} y={18} dominantBaseline="central">{(v.ghost ? '+ ' : '') + (v.label.length > 24 ? v.label.slice(0, 23) + '…' : v.label)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="layer-hint">{plural(g.nodes.size, 'note', 'notes')} · {plural(g.edges.length, 'lien', 'liens')}. Touchez une note pour l’ouvrir ; les cadres pointillés n’existent pas encore.</p>
    </>
  );
}

/* ---------- Overview of a folder, tag or collection ---------- */
function Overview() {
  useStore(s => s.notes);
  const readable = useStore(readableNotes), notes = tabNotes();
  const atts = (type: string) => notes.flatMap(n => n.atts.filter(a => a.type === type).map(a => ({ note: n, a })));
  const photos = atts('image'), audio = atts('audio'), pdfs = atts('pdf'), links = notes.flatMap(n => entities(n).urls.map(u => ({ note: n, u })));
  const due = notes.flatMap(n => dueCards(n)).length, linked = notes.some(n => entities(n).links.length || backlinks(n, readable).length);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const coming = notes.flatMap(n => [
    ...(n.remind && !n.remindDone ? [{ note: n, at: n.remind, hasTime: true, reminder: true }] : []),
    ...entities(n).dates.filter(d => d.start >= today).map(d => ({ note: n, at: +d.start, hasTime: d.hasTime, reminder: false })),
  ]).sort((a, b) => a.at - b.at).slice(0, 8);
  const stat = (n: number, one: string, many: string) => n > 0 && <span className="stat">{plural(n, one, many)}</span>;
  const go = (n: Note) => () => { closeSheet(); open(n.id); };
  return (
    <>
      <div className="stats">{stat(notes.length, 'note', 'notes')}{stat(photos.length, 'photo', 'photos')}{stat(audio.length, 'note vocale', 'notes vocales')}{stat(pdfs.length, 'PDF', 'PDF')}{stat(links.length, 'lien', 'liens')}</div>
      <div className="chips">
        {due > 0 && <Chip icon="study" label={'Réviser ' + plural(due, 'carte', 'cartes')} onClick={() => startStudy(notes)} />}
        {linked && <Chip icon="graph" label="Carte des liens" onClick={() => openMap()} />}
        <Chip icon="download" label="Exporter en Markdown" onClick={exportMarkdown} />
        <Chip icon="slides" label="Présentation .pptx" onClick={exportSlides} />
        <Chip icon="print" label="Imprimer ou PDF" onClick={printTab} />
      </div>
      <Section title="À venir" show={coming.length > 0}>
        {coming.map((c, i) => <Row key={i} icon={c.reminder ? 'bell' : 'calendar'} label={c.note.title || 'Sans titre'} trailing={c.hasTime ? dayTime(c.at) : day(c.at)} onClick={go(c.note)} />)}
      </Section>
      <Section title="Photos" show={photos.length > 0}>
        <div className="photos">{photos.slice(0, 12).map(({ note, a }, i) => (
          <button key={i} className="photo" onClick={go(note)} aria-label={'Ouvrir la note ' + (note.title || 'Sans titre')}><img src={urlOf(a)} alt="" loading="lazy" /></button>
        ))}</div>
      </Section>
      <Section title="Notes vocales" show={audio.length > 0}>
        {audio.map(({ note, a }, i) => <Row key={i} icon="audio" label={note.title || 'Note vocale'} trailing={a.duration ? clock(Math.round(a.duration)) : ''} onClick={go(note)} />)}
      </Section>
      <Section title="PDF" show={pdfs.length > 0}>
        {pdfs.map(({ note, a }, i) => <Row key={i} icon="doc" label={a.name || note.title || 'Document PDF'} trailing={a.pages ? plural(a.pages, 'page', 'pages') : ''} onClick={go(note)} />)}
      </Section>
      <Section title="Liens" show={links.length > 0}>
        <div className="chips">{links.slice(0, 16).map(({ u }, i) => <Chip key={i} icon="link" label={hostOf(u)} aria={'Ouvrir ' + u} onClick={() => window.open(withScheme(u), '_blank', 'noopener')} />)}</div>
      </Section>
      {!notes.length && <Empty title="Ce dossier est vide." />}
    </>
  );
}

/* ---------- Settings ---------- */
/** Only what works today. Help and version live together; storage protection happens by itself. */
function Settings() {
  const s = useStore(useShallow(s => ({
    lastBackup: s.prefs.lastBackup, canInstall: !!s.install.prompt, ocr: !!s.prefs.ocr,
    read: s.notes.reduce((t, n) => t + n.atts.filter(a => a.type === 'image' && a.text != null).length, 0),
    asr: !!s.prefs.asr, heard: s.notes.reduce((t, n) => t + n.atts.filter(a => a.type === 'audio' && a.text != null).length, 0),
    pin: !!s.pinHash, device: !!s.vault?.device,
  })));
  const [canDevice, setCanDevice] = useState(false);
  useEffect(() => { deviceAvailable().then(setCanDevice); }, []);
  return (
    <div className="cols">
      <div>
        <Segmented pref="look" label="Style" options={LOOKS} />
        <Segmented pref="accent" label="Accent" options={ACCENTS} />
        <Segmented pref="theme" label="Thème" options={THEMES} />
        <Segmented pref="hand" label="Main dominante" options={HANDS} />
        <Segmented pref="tint" label="Couleur des dossiers" options={[['off', 'Pastille'], ['on', 'Teinter']]} />
      </div>
      <div>
        {s.canInstall && <><h4>Application</h4><button className="option" onClick={install}>Installer l’app sur cet appareil</button></>}
        <h4>Recherche</h4>
        <Switch on={s.ocr} label="Texte dans les photos" note={s.ocr ? (s.read ? plural(s.read, 'photo lue', 'photos lues') : '') : '≈ 5 Mo, sur l’appareil'} onClick={toggleOcr} />
        <Switch on={s.asr} label="Texte des notes vocales" note={s.asr ? (s.heard ? plural(s.heard, 'note vocale transcrite', 'notes vocales transcrites') : '') : '≈ 55 Mo, sur l’appareil'} onClick={toggleAsr} />
        {s.pin && <>
          <h4>Notes masquées</h4>
          {canDevice && <Switch on={s.device} label="Face ID ou empreinte" note={s.device ? 'Ouvre les notes masquées' : 'Le code PIN suffit aussi'} onClick={toggleDeviceUnlock} />}
          <button className="option" onClick={changePin}>Changer le code PIN</button>
        </>}
        <h4>Sauvegarde</h4>
        <button className="option" onClick={exportBackup}><span>Exporter les notes</span><small>{lastBackupLabel(s.lastBackup)}</small></button>
        <button className="option" onClick={() => pickFile('backup')}>Importer une sauvegarde</button>
        <button className="option" onClick={exportVault}><span>Exporter en Markdown (.zip)<span className="option-note">Dossiers et pièces jointes, pour Obsidian et les autres apps</span></span></button>
        <h4>Aide</h4>
        <button className="option" onClick={startTour}>Visite guidée</button>
        <button className="option" onClick={openGuide}>Guide d’utilisation</button>
        <button className="option" onClick={openNews}><span>Quoi de neuf</span><small>{VERSION}</small></button>
        <button className="option" onClick={() => openSheet('about')}>À propos</button>
      </div>
    </div>
  );
}

/* ---------- About, what's new, guide: with the changelog, loaded when one of them opens (Changelog.tsx) ---------- */
const About = lazy(() => import('./Changelog').then(m => ({ default: m.About })));
const News = lazy(() => import('./Changelog').then(m => ({ default: m.News })));
const Guide = lazy(() => import('./Changelog').then(m => ({ default: m.Guide })));

const SHEETS: Record<SheetMode, { title: (center: number | null) => string; Content: React.ComponentType; Foot?: () => React.ReactNode }> = {
  study: { title: () => 'Réviser', Content: Study, Foot: StudyFoot },
  map: { title: (c: number | null) => (c !== null ? 'Carte des liens · ' + (noteById(c)?.title || 'Sans titre') : 'Carte des liens'), Content: LinkMap },
  overview: { title: () => tabLabel(useStore.getState().prefs.tab), Content: Overview },
  settings: { title: () => 'Réglages', Content: Settings },
  about: { title: () => 'À propos', Content: About },
  news: { title: () => 'Quoi de neuf', Content: News, Foot: () => <Btn primary label="Continuer" onClick={closeSheet} /> },
  guide: { title: () => 'Guide d’utilisation', Content: Guide },
};

/** Recurring tools open on the thumb's side of a wide screen; long focused tasks take the whole screen (CSS). */
const SIDE_SHEETS: SheetMode[] = ['overview', 'settings', 'about', 'news', 'guide'];
const FULL_SHEETS: SheetMode[] = ['study', 'map'];

export function SheetHost() {
  const mode = useStore(s => s.sheet), center = useStore(s => s.mapCenter);
  const def = mode ? SHEETS[mode] : null, title = def?.title(center) || '', Foot = def?.Foot;
  // On a phone the others are bottom sheets: a handle, and a pull down on the head closes them (gestures.ts)
  return (
    <Layer open={!!mode} onClose={closeSheet} label={title} className="sheet glass" drawer={!!mode && SIDE_SHEETS.includes(mode)}
      data={{ 'data-mode': mode || undefined, 'data-drag': mode && !FULL_SHEETS.includes(mode) ? '' : undefined }}
      initialFocus={() => document.querySelector<HTMLElement>('.sheet-foot .is-ink') || document.getElementById('sheet-close')}>
      {def && <>
        {!FULL_SHEETS.includes(mode!) && <span className="sheet-grabber" aria-hidden="true" />}
        <div className="sheet-head"><h2 aria-hidden="true">{title}</h2><button className="ctl is-icon" id="sheet-close" onClick={closeSheet} aria-label="Fermer"><Icon name="close" /></button></div>
        <div className="sheet-body" key={mode}><Suspense fallback={null}><def.Content /></Suspense></div>
        {Foot && <div className="sheet-foot"><Foot /></div>}
      </>}
    </Layer>
  );
}

export function Toast() {
  const t = useStore(s => s.toast);
  return t ? (
    <div className="toast glass" key={t.id} role="status">
      {t.kind && <StateMark kind={t.kind} />}
      <span>{t.message}</span>
      {t.action && <button className="ctl is-s is-ink" onClick={runToastAction}>{t.label}</button>}
    </div>
  ) : null;
}

export function PrintArea() {
  const notes = useStore(s => s.printing), tab = useStore(s => s.prefs.tab);
  return notes ? createPortal(
    <div id="print-area" aria-hidden="true">
      <h1>{tabLabel(tab)}</h1>
      {notes.map(n => (
        <article key={n.id}>
          <h2>{n.title || 'Sans titre'}</h2>
          <div className="print-body"><Formatted body={n.body} /></div>
          {n.atts.filter(a => a.type === 'image').map((a, i) => <img key={i} src={urlOf(a)} alt="" />)}
        </article>
      ))}
    </div>, document.body) : null;
}
