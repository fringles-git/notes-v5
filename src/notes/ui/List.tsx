/** Header, info pills and the note list (cards or rows, pinned shelf, search days, masonry, paging). */
import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Note } from '../types';
import { CONFIG } from '../config';
import { checkStats, dueCards, entities, parseCheck, plainText, snippet } from '../markdown';
import { firstAtt, urlOf } from '../media';
import { countIn, folderColor, inTrash, readableNotes, tabFolder, tabLabel, useStore, visibleNotes } from '../store';
import {
  changePin, createAndOpen, emptyTrash, fromTemplate, goHome, goLibrary, menuPin, menuTrash, onCard, open, openImport, openLayer, openNoteMenu,
  openPicker, openSheet, setPref, setTab, toggleCardCheck, toggleSelected,
} from '../actions';
import { backupDue, currentHint, dismissHint, exportBackup, openGuide, playCard, startStudy, toggleRecording } from '../features';
import { consumeClick } from '../gestures';
import { bytes, clock, day, daysAgo, dayTime, eventDate, finePointer, fullDay, plural, relativeDay, time } from '../utils';
import { FolderTag, Formatted, Highlight } from './kit';
import { Icon } from './icons';

export function Header() {
  const count = useStore(s => visibleNotes(s).length);
  const s = useStore(useShallow(s => ({ tab: s.prefs.tab, colors: s.folderColors, query: s.query, trash: inTrash(s), selecting: s.selecting, prefs: s.prefs })));
  const title = s.tab === 'all' ? 'Notes' : tabLabel(s.tab), folder = tabFolder(s.tab);
  const sorted = s.prefs.sort !== 'updated' || s.prefs.dir !== 'desc';
  return (
    <header className="app-header" id="app-header">
      <div className="pull-hint" aria-hidden="true"><Icon name="search" /><span>Rechercher</span></div>
      <div className="header-bar">
        {s.tab !== 'all' && <button className="back-chip glass" onClick={goLibrary}><Icon name="back" /><span>Bibliothèque</span></button>}
        <h1 id="page-title" data-color={folder ? folderColor(folder, s.colors) : undefined} onClick={goHome}>
          {title}{count > 0 && <span className="title-count" aria-hidden="true">{count}</span>}
        </h1>
        <div className="island glass header-tools" id="view-tools">
          <button className="icon-btn" onClick={() => setPref('view', s.prefs.view === 'cards' ? 'list' : 'cards')}
            aria-label={s.prefs.view === 'cards' ? 'Afficher en liste compacte' : 'Afficher en cartes'}><Icon name={s.prefs.view === 'cards' ? 'list' : 'cards'} /></button>
          <button className={'icon-btn' + (sorted ? ' has-dot' : '')} onClick={() => openLayer('sort')} aria-haspopup="dialog" aria-label={'Trier' + (sorted ? ' (modifié)' : '')}><Icon name="sort" /></button>
        </div>
      </div>
      <span className="visually-hidden" aria-live="polite">
        {(s.trash ? plural(count, 'note supprimée', 'notes supprimées') : plural(count, 'note', 'notes')) + (s.query.trim() ? ' · résultats de recherche' : '')}
      </span>
    </header>
  );
}

export function InfoBar() {
  const s = useStore(useShallow(s => ({
    tab: s.prefs.tab, lastBackup: s.prefs.lastBackup, selecting: s.selecting, query: s.query, unlocked: s.hiddenUnlocked,
    trashCount: inTrash(s) ? countIn(s, 'trash') : 0,
    // Tips are about handling notes: they wait until there are a few
    hint: s.prefs.tab === 'all' && !s.selecting && !s.searchOpen && s.notes.filter(n => !n.deleted).length >= 3 ? currentHint(s.prefs, finePointer()) : null,
    ios: s.install.ios && !s.install.standalone && !s.prefs.iosInstallDismissed && !s.memOnly && s.prefs.tab === 'all',
    backup: backupDue(s) && s.prefs.tab === 'all' && !s.selecting && !s.searchOpen,
  })));
  const pills = [
    s.trashCount > 0 && <button key="trash" className="pill danger" onClick={emptyTrash}>Vider la corbeille ({s.trashCount})</button>,
    /^[ftc]:/.test(s.tab) && !s.selecting && !s.query.trim() && <button key="ov" className="pill" onClick={() => openSheet('overview')}>Vue d’ensemble</button>,
    s.backup && <button key="backup" className="pill" onClick={exportBackup}>
      {s.lastBackup ? `Dernière sauvegarde il y a ${daysAgo(s.lastBackup)} jours. Exporter` : 'Aucune sauvegarde. Exporter les notes'}
    </button>,
    s.hint && <button key="hint" className="pill" onClick={() => dismissHint(s.hint!.id)} aria-label={'Masquer l’astuce : ' + s.hint.text}>{s.hint.text}<Icon name="close" /></button>,
    s.tab === 'locked' && s.unlocked && <button key="pin" className="pill" onClick={changePin}>Changer le code PIN</button>,
    s.ios && <button key="ios" className="pill" onClick={() => openLayer('ios-install')}>Protéger mes notes sur iPhone</button>,
  ].filter(Boolean);
  return pills.length ? <div className="info-bar">{pills}</div> : null;
}

/* ---------- Récap: what matters today, at a glance (only what exists) ---------- */
type Widget = { key: string; tone: string; icon: string; label: string; title: string; detail?: string; img?: string; onClick: () => void };
function widgets(notes: Note[]): Widget[] {
  const now = Date.now(), out: Widget[] = [];
  // Open → write → close → come back: the note you were just writing, first and amber (current)
  const recent = notes.filter(n => n.updated > n.created && now - n.updated < CONFIG.resumeMs && (n.title || n.body).trim())
    .sort((a, b) => b.updated - a.updated)[0];
  if (recent) out.push({ key: 'resume', tone: 'yellow', icon: 'edit', label: 'Reprendre', title: recent.title || 'Sans titre', detail: 'Modifiée à ' + time(recent.updated), onClick: () => open(recent.id) });
  const soon = notes.flatMap(n => [
    ...(n.remind && !n.remindDone && n.remind > now ? [{ n, at: n.remind, time: true }] : []),
    ...entities(n).dates.filter(d => +d.start >= now - 36e5 * 12).map(d => ({ n, at: +d.start, time: d.hasTime })),
  ]).filter(x => x.at < now + 14 * 864e5).sort((a, b) => a.at - b.at);
  if (soon.length) out.push({
    key: 'soon', tone: 'orange', icon: 'calendar', label: 'À venir', title: soon[0].n.title || 'Sans titre',
    detail: eventDate(new Date(soon[0].at), soon[0].time) + (soon.length > 1 ? ' · +' + (soon.length - 1) : ''), onClick: () => open(soon[0].n.id),
  });
  const due = notes.filter(n => dueCards(n).length), cards = due.reduce((t, n) => t + dueCards(n).length, 0);
  if (cards) out.push({ key: 'study', tone: 'indigo', icon: 'study', label: 'À réviser', title: plural(cards, 'carte', 'cartes'), detail: plural(due.length, 'note', 'notes'), onClick: () => startStudy(due) });
  // What is left to do, counted — the items themselves are on the cards below
  const todo = notes.map(n => ({ n, left: n.body.split('\n').map(parseCheck).filter(c => c && !c.done && c.text.trim()).length }))
    .filter(x => x.left).sort((a, b) => b.n.updated - a.n.updated);
  if (todo.length) out.push({
    key: 'todo', tone: 'blue', icon: 'checklist', label: 'À faire', title: plural(todo.reduce((t, x) => t + x.left, 0), 'tâche restante', 'tâches restantes'),
    detail: todo.length > 1 ? plural(todo.length, 'liste', 'listes') : 'Dans ' + (todo[0].n.title || 'Sans titre'),
    onClick: () => (todo.length > 1 ? setTab('lists') : open(todo[0].n.id)),
  });
  const media = notes.filter(n => n.created > now - 7 * 864e5 && n.atts.some(a => a.type === 'image' || a.type === 'audio')).sort((a, b) => b.created - a.created)[0];
  if (media) {
    const photo = firstAtt(media, 'image'), audio = firstAtt(media, 'audio');
    out.push({
      key: 'media', tone: photo ? 'green' : 'pink', icon: photo ? 'image' : 'audio', label: photo ? 'Photo récente' : 'Note vocale',
      title: media.title || 'Sans titre', detail: audio?.duration ? clock(Math.round(audio.duration)) : day(media.created), img: photo && urlOf(photo), onClick: () => open(media.id),
    });
  }
  const old = notes.filter(n => n.updated < now - 30 * 864e5 && (n.title || n.body).trim());
  if (old.length) {
    const pick = old[Math.floor(now / 864e5) % old.length], ago = daysAgo(pick.updated);
    out.push({
      key: 'memory', tone: 'purple', icon: 'history', label: 'Souvenir', title: pick.title || 'Sans titre',
      detail: ago >= 365 ? 'Il y a ' + plural(Math.floor(ago / 365), 'an', 'ans') : ago >= 60 ? 'Il y a ' + Math.floor(ago / 30) + ' mois' : 'Il y a ' + ago + ' jours',
      onClick: () => open(pick.id),
    });
  }
  return out;
}
export function Recap() {
  const notes = useStore(readableNotes), show = useStore(s => s.prefs.tab === 'all' && !s.searchOpen && !s.selecting);
  const list = useMemo(() => widgets(notes), [notes]);
  if (!show) return null;
  const h = new Date().getHours();
  return (
    <section className="recap" aria-label="Récapitulatif">
      <p className="page-sub"><b>{h >= 5 && h < 18 ? 'Bonjour' : 'Bonsoir'}</b> · {fullDay(Date.now())}</p>
      {list.length > 0 && (
        <div className="recap-row">
          {list.map((w, i) => (
            <button key={w.key} className="widget" data-tone={w.tone} data-size={list.length > 2 && (i === 0 || w.img) ? 'tall' : undefined} onClick={w.onClick}
              title={w.detail ? w.title + ' · ' + w.detail : undefined}>
              {w.img && <img src={w.img} alt="" />}
              <span className="widget-label"><Icon name={w.icon} />{w.label}</span>
              <b className="widget-title">{w.title}</b>
              {w.detail && <span className="widget-detail">{w.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------- Card ---------- */
function Wave({ noteId, att }: { noteId: number; att: NonNullable<ReturnType<typeof firstAtt>> }) {
  const player = useStore(s => (s.player.id === noteId ? s.player : null)), dur = att.duration || 0;
  const progress = player && dur ? player.time / dur : 0, peaks = att.peaks || Array(CONFIG.wavePeaks).fill(0);
  return (
    <>
      <button className="wave-play" onClick={() => playCard(noteId, urlOf(att))} aria-label={player?.playing ? 'Pause' : 'Lire l’audio'}>
        <Icon name={player?.playing ? 'pause' : 'play'} />
      </button>
      <span className={'wave' + (player?.playing ? ' is-playing' : '')} aria-hidden="true">
        {peaks.map((p, i) => <i key={i} className={player && i < progress * peaks.length ? 'played' : undefined} style={{ '--h': Math.round(p * 100) + '%' } as React.CSSProperties} />)}
      </span>
      <span className="wave-time">{player ? clock(Math.floor(player.time)) : dur ? clock(Math.round(dur)) : ''}</span>
    </>
  );
}
export const pdfMeta = (a: { pages?: number; size?: number }) => [a.pages && plural(a.pages, 'page', 'pages'), bytes(a.size || 0)].filter(Boolean).join(' · ');

function CardMedia({ note }: { note: Note }) {
  const [broken, setBroken] = useState(false), img = firstAtt(note, 'image'), audio = firstAtt(note, 'audio'), pdf = firstAtt(note, 'pdf');
  if (note.locked || !(img || audio || pdf)) return null;
  if (img) return <div className={'card-media card-photo' + (broken ? ' is-broken' : '')}><img src={urlOf(img)} alt="" loading="lazy" onError={() => setBroken(true)} /><Icon name="image" /></div>;
  if (audio) return <div className="card-media card-wave"><Wave noteId={note.id} att={audio} /></div>;
  return <div className="card-media card-pdf"><Icon name="doc" /><span className="pdf-name">{pdf!.name || 'Document PDF'}</span><span className="pdf-meta">{pdfMeta(pdf!)}</span></div>;
}

function match(n: Note, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const text = plainText(n.body), at = text.toLowerCase().indexOf(q);
  if (at > -1) return at > 80 ? { text: snippet(text, at, q.length), source: null } : null;
  const a = n.atts.find(x => x.text?.toLowerCase().includes(q));
  return a ? { text: snippet(a.text!, a.text!.toLowerCase().indexOf(q), q.length), source: a.type } : null;
}
/** Marks card texts taller than their box: they fade out at the bottom instead of ending on a cut line. */
const clampWatch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => entries.forEach(({ target: el }) =>
  el.classList.toggle('is-clamped', el.scrollHeight > el.clientHeight + 1)));
const watchClamp = (el: HTMLElement | null) => {
  if (!el || !clampWatch) return;
  clampWatch.observe(el);
  return () => clampWatch.unobserve(el);
};
const oneLine = (body: string) => plainText(body).replace(/\s+/g, ' ').trim();

function CardBody({ note, readable, query, compact }: { note: Note; readable: boolean; query: string; compact: boolean }) {
  if (!readable) return <div className="card-body"><i>Contenu masqué</i></div>;
  const m = match(note, query);
  if (m) return <div className="card-body is-snippet" ref={watchClamp}>{m.source && <><span className="snippet-source">{m.source === 'pdf' ? 'Dans le PDF' : 'Dans la photo'}</span> </>}<Highlight text={m.text} query={query} /></div>;
  if (compact) return note.body.trim() ? <div className="card-body is-line"><Highlight text={oneLine(note.body)} query={query} /></div> : null;
  return note.body ? <div className="card-body" ref={watchClamp}><Formatted body={note.body} query={query} onToggle={(l, on) => toggleCardCheck(note.id, l, on)} /></div> : null;
}
const Count = ({ icon, text, spoken, className = '' }: { icon: string; text: string; spoken: string; className?: string }) => (
  <span className={'count ' + className}><Icon name={icon} /><span aria-hidden="true">{text}</span><span className="visually-hidden">{spoken}</span></span>
);
function CardFooter({ note }: { note: Note }) {
  if (note.locked) return null;
  const { done, total } = checkStats(note.body), due = dueCards(note).length, remind = !!note.remind && !note.remindDone;
  const items = [
    note.atts.length > 0 && <Count key="a" icon="attach" text={String(note.atts.length)} spoken={plural(note.atts.length, 'pièce jointe', 'pièces jointes')} />,
    due > 0 && <Count key="d" icon="study" text={String(due)} spoken={plural(due, 'carte à réviser', 'cartes à réviser')} />,
    remind && <Count key="r" icon="bell" text={dayTime(note.remind!)} spoken={'Rappel ' + dayTime(note.remind!)} />,
    note.by === 'ai' && <span key="ai" className="count">IA</span>,
  ].filter(Boolean);
  return <>
    {total > 0 && (
      <div className={'card-progress' + (done === total ? ' is-done' : '')} role="progressbar" aria-label="Progression de la liste"
        aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={`${done} sur ${total}`}>
        <span className="progress-track"><span className="progress-fill" style={{ '--progress': Math.round((done / total) * 100) + '%' } as React.CSSProperties} /></span>
        <span aria-hidden="true">{done}/{total}</span>
      </div>
    )}
    {items.length > 0 && <div className="card-footer">{items}</div>}
  </>;
}

/** With a mouse, hovering a card offers its three most used actions (touch has the swipes). Mouse only: out of the Tab order. */
function QuickActions({ note, title }: { note: Note; title: string }) {
  const act = (label: string, icon: string, run: () => void, danger = false) => (
    <button className={danger ? 'danger' : undefined} tabIndex={-1} onClick={() => onCard(note.id, run)} aria-label={label + ' : ' + title} title={label}><Icon name={icon} /></button>
  );
  return (
    <span className="card-actions">
      {act(note.pinned ? 'Désépingler' : 'Épingler', 'pin', menuPin)}
      {act('Déplacer', 'move', openPicker)}
      {act('Supprimer', 'trash', menuTrash, true)}
    </span>
  );
}

interface CardProps {
  note: Note; inShelf: boolean; grip: boolean; selected: boolean; selecting: boolean; isOpen: boolean; readable: boolean;
  query: string; color: number | null; date: number; showFolder: boolean; compact: boolean;
}
const Card = memo(function Card({ note, inShelf, grip, selected, selecting, isOpen, readable, query, color, date, showFolder, compact }: CardProps) {
  const title = note.title || 'Sans titre';
  return (
    <article className={'card' + (selected ? ' selected' : '') + (grip ? ' has-grip' : '') + (isOpen ? ' is-open' : '')}
      data-id={note.id} data-color={color ?? undefined} data-pinned={note.pinned || undefined}>
      <span className="card-check" aria-hidden="true"><Icon name="check" /></span>
      {grip && <span className="card-grip" aria-hidden="true" title="Glisser, ou Alt + ↑ ↓, pour réordonner"><Icon name="grip" /></span>}
      {!compact && <CardMedia note={note} />}
      <div className="card-head">
        <h3 className="card-title">
          <button className="card-open" aria-pressed={selecting ? selected : undefined}
            onClick={() => { if (consumeClick()) return; if (selecting) toggleSelected(note.id); else open(note.id); }}>
            <Highlight text={title} query={query} />
          </button>
        </h3>
        {!selecting && <button className="card-more" onClick={() => openNoteMenu(note.id)} aria-label={'Actions : ' + title} aria-haspopup="dialog"><Icon name="more" /></button>}
      </div>
      {!selecting && !note.deleted && <QuickActions note={note} title={title} />}
      <p className="card-meta">
        {note.pinned && !inShelf && <><Icon name="pin" className="pin-mark" /><span className="visually-hidden">Épinglée. </span></>}
        {note.locked && <><Icon name="lock" /><span className="visually-hidden">Masquée. </span></>}
        <span>{relativeDay(date)}</span>
        {showFolder && note.folder && <FolderTag folder={note.folder} />}
      </p>
      <CardBody note={note} readable={readable} query={query} compact={compact} />
      {!compact && <CardFooter note={note} />}
    </article>
  );
});

function Empty() {
  const filtered = useStore(s => !!s.query.trim() || !!s.searchKind), trash = useStore(inTrash);
  return <div className="empty">{filtered ? 'Aucune note ne correspond.' : trash ? 'Corbeille vide.' : 'Aucune note. Touchez + pour écrire la première.'}</div>;
}
/** First use: the workspace starts empty — no tutorial notes — with one invitation that leaves with the first note. */
function FirstUse() {
  return (
    <section className="first-use" aria-labelledby="first-use-title">
      <h2 id="first-use-title">Votre première note</h2>
      <p>Écrivez, cochez, dictez ou importez. Tout reste sur cet appareil, même hors ligne.</p>
      <div className="first-actions">
        <button className="first-action is-main" onClick={() => createAndOpen()}><Icon name="edit" />Note</button>
        <button className="first-action" onClick={() => fromTemplate('list')}><Icon name="checklist" />Liste</button>
        <button className="first-action" onClick={toggleRecording}><Icon name="mic" />Vocal</button>
        <button className="first-action" onClick={() => openImport('new')} aria-haspopup="dialog"><Icon name="download" />Importer</button>
      </div>
      <button className="text-btn" onClick={openGuide}>Lire le guide</button>
    </section>
  );
}

const dayGroup = (t: number) => {
  const n = daysAgo(t);
  return n <= 0 ? 'Aujourd’hui' : n < 7 ? 'Cette semaine' : n < 30 ? 'Ce mois-ci' : 'Plus tôt';
};

/** CSS grid masonry: each card spans as many 1px rows as it is tall. */
function useMasonry(list: React.RefObject<HTMLElement | null>, on: boolean, deps: unknown[]) {
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const items = [...el.children] as HTMLElement[];
    if (!on || !window.ResizeObserver) return void items.forEach(c => c.style.removeProperty('grid-row-end'));
    const row = parseFloat(getComputedStyle(el).gridAutoRows) || 1, gap = (items.length && parseFloat(getComputedStyle(items[0]).marginBottom)) || 0;
    const fit = (cards: HTMLElement[]) => cards.forEach(c => {
      const span = 'span ' + Math.max(1, Math.ceil((c.offsetHeight + gap) / row));
      if (c.style.gridRowEnd !== span) c.style.gridRowEnd = span;
    });
    fit(items);
    const dirty = new Set<HTMLElement>();
    let frame = 0;
    const ro = new ResizeObserver(entries => {
      entries.forEach(e => dirty.add(e.target as HTMLElement));
      frame ||= requestAnimationFrame(() => { frame = 0; fit([...dirty].filter(c => c.isConnected)); dirty.clear(); });
    });
    items.forEach(c => ro.observe(c));
    return () => { ro.disconnect(); cancelAnimationFrame(frame); };
  }, deps);
}

export function NoteList({ onShown }: { onShown: (notes: Note[]) => void }) {
  const notes = useStore(visibleNotes);
  const s = useStore(useShallow(s => ({
    prefs: s.prefs, query: s.query, kind: s.searchKind, selecting: s.selecting, selection: s.selection, editorId: s.editor.id,
    unlocked: s.hiddenUnlocked, colors: s.folderColors, trash: inTrash(s), searching: s.searchOpen,
    blank: s.prefs.tab === 'all' && !s.searchOpen && !s.notes.some(n => !n.deleted),
  })));
  const ref = useRef<HTMLElement>(null), more = useRef<HTMLButtonElement>(null);
  const key = [s.prefs.tab, s.prefs.sort, s.prefs.dir, s.query, s.kind].join('|');
  const [page, setPage] = useState({ key, limit: CONFIG.pageSize as number });
  const limit = page.key === key ? page.limit : CONFIG.pageSize, shown = useMemo(() => notes.slice(0, limit), [notes, limit]);
  const left = notes.length - shown.length, next = () => setPage({ key, limit: limit + CONFIG.pageSize });
  const recents = s.searching && !s.query.trim() && !s.kind, pinned = s.trash || s.searching ? 0 : notes.filter(n => n.pinned).length;
  const cards = s.prefs.view === 'cards' && !s.searching, compact = s.prefs.view === 'list' && !s.searching, showFolder = !s.prefs.tab.startsWith('f:');
  const folded = !!s.prefs.pinnedFolded;

  useMasonry(ref, cards, [shown, cards, s.selecting, s.query, folded]);
  useEffect(() => onShown(shown), [shown, onShown]);
  useEffect(() => {
    const el = more.current;
    if (!el || !window.IntersectionObserver) return;
    const io = new IntersectionObserver(e => e.some(x => x.isIntersecting) && next(), { rootMargin: '800px 0px' });
    io.observe(el);
    return () => io.disconnect();
  });

  const card = (n: Note, inShelf: boolean) => (
    <Card key={n.id} note={n} inShelf={inShelf} grip={n.pinned && pinned > 1} selecting={s.selecting} selected={s.selecting && s.selection.has(n.id)}
      isOpen={s.editorId === n.id} readable={!n.locked || s.unlocked} query={s.query} color={n.folder ? folderColor(n.folder, s.colors) : null}
      date={s.prefs.sort === 'created' ? n.created : n.updated} showFolder={showFolder} compact={compact} />
  );
  const section = (title: string, count: number, list: Note[], inShelf: boolean) => list.length > 0 && (
    <Fragment key={title}>
      <h2 className="list-heading">{title}<span className="heading-count">{count}</span></h2>
      {list.map(n => card(n, inShelf))}
    </Fragment>
  );
  /** Pinned notes stay on top, apart from the flow of recent ones; the shelf folds away in one tap. */
  const shelf = () => (
    <Fragment key="pinned">
      <h2 className="list-heading">
        <button className="list-heading is-toggle" aria-expanded={!folded} onClick={() => setPref('pinnedFolded', !folded)}>
          <Icon name="pin" className="pin-mark" />Épinglées<span className="heading-count">{pinned}</span><Icon name="back" className="chevron" />
        </button>
      </h2>
      {!folded && shown.filter(n => n.pinned).map(n => card(n, true))}
    </Fragment>
  );
  const newestFirst = s.prefs.sort === 'updated' && s.prefs.dir === 'desc';
  let body: React.ReactNode;
  if (!notes.length) body = s.blank ? <FirstUse /> : <Empty />;
  else if (recents) {
    const groups = new Map<string, Note[]>();
    [...shown].sort((a, b) => b.updated - a.updated).forEach(n => groups.set(dayGroup(n.updated), [...(groups.get(dayGroup(n.updated)) || []), n]));
    body = [<h2 key="r" className="list-heading is-section">Récents</h2>, ...[...groups].map(([t, l]) => section(t, l.length, l, false))];
  } else if (pinned > 0 && pinned < notes.length)
    body = [shelf(), section(newestFirst ? 'Récentes' : 'Autres notes', notes.length - pinned, shown.filter(n => !n.pinned), false)];
  else body = shown.map(n => card(n, false));

  return (
    <main className={'note-list' + (cards ? ' cards' : '') + (compact ? ' is-compact' : '')} id="note-list" ref={ref}>
      {body}
      {left > 0 && <button className="text-btn list-more" ref={more} onClick={next}>Afficher {plural(Math.min(left, CONFIG.pageSize), 'note', 'notes')} de plus</button>}
    </main>
  );
}
