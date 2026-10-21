/** The note editor: a full-height glass sheet. Formatted view until touched; every tool sits at the bottom. */
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Attachment, Note } from '../types';
import { CONFIG, DAY, TEMPLATES } from '../config';
import { backlinks, entities, headingLevel, hostOf, noteTools, titleIndex, withScheme, wordCount, type FormatState } from '../markdown';
import { urlOf } from '../media';
import { openNote, readableNotes, useStore } from '../store';
import {
  applyFormat, applyTemplate, backToReading, caretFormat, closeEditor, editAt, editField, editorRefs, extractSelection, FORMAT_TOOLS, onEditorKey,
  open, openImport, openLayer, openLink, openNoteMenu, openPicker, patchEditor, removeAtt, setTab, toast, toggleFormatBar, toggleOpenCheck,
} from '../actions';
import { addAttText, attText, audioRate, cycleRate, editorAudios, openMap, pauseOthers, startStudy, toCalendar } from '../features';
import { clock, dayOrTime, eventDate, finePointer, goUrl, isToday, MOD, openUrl, plural, rate } from '../utils';
import { Chip, FolderTag, Formatted } from './kit';
import { Icon } from './icons';
import { pdfMeta } from './List';

/** In the note's top bar: shows while typing and for a moment after saving, then fades (CSS); a failure stays. */
function SaveStatus() {
  const s = useStore(useShallow(s => ({ status: s.editor.saveStatus, last: s.editor.lastSaved, mem: s.memOnly })));
  const status = s.mem ? 'error' : s.status;
  const label = s.mem ? 'Non conservé' : { saving: 'Enregistrement…', error: 'Non enregistré', modified: 'Modifié', saved: 'Enregistré' }[s.status];
  const when = s.status === 'saved' && !s.mem && s.last ? (isToday(s.last) ? ' à ' : ' le ') + dayOrTime(s.last) : '';
  // Only a failure is announced: autosave states would speak at every pause in typing
  return <span className="save-status" data-status={status} aria-live={status === 'error' ? 'assertive' : 'off'} title={s.mem ? label + ' : stockage indisponible' : label + when}><i aria-hidden="true" /><span>{label}</span><span className="visually-hidden">{when}</span></span>;
}

/** Outline, flashcards and link map, one tap away under the title. */
function Tools({ note }: { note: Note }) {
  const { heads, cards, due, linked } = noteTools(note, useStore(readableNotes));
  if (note.deleted || (heads < 2 && !cards && !linked)) return null;
  return (
    <div className="chips note-tools" role="group" aria-label="Outils de la note">
      {heads > 1 && <Chip icon="outline" label="Plan" aria={'Plan de la note : ' + plural(heads, 'titre', 'titres')} onClick={() => openLayer('outline')} />}
      {cards > 0 && <Chip icon="study" label={due ? plural(due, 'carte à réviser', 'cartes à réviser') : plural(cards, 'carte', 'cartes')} aria="Réviser les cartes de cette note" onClick={() => startStudy([note])} />}
      {linked && <Chip icon="graph" label="Carte des liens" aria="Voir la carte des liens autour de cette note" onClick={() => openMap(note.id)} />}
    </div>
  );
}

/** Dates, places, numbers and links found in the note, as buttons. */
function Found({ note }: { note: Note }) {
  const readable = useStore(readableNotes);
  if (note.deleted) return null;
  const e = entities(note), byTitle = titleIndex(readable), back = backlinks(note, readable);
  const when = (d: { start: Date; hasTime: boolean }) => eventDate(d.start, d.hasTime);
  const chips = [
    ...e.dates.map(d => <Chip key={'d' + +d.start} icon="calendar" label={when(d)} aria={'Ajouter à l’agenda : ' + when(d)} onClick={() => toCalendar(note, d.start, { hasTime: d.hasTime })} />),
    ...e.addresses.map(a => <Chip key={'a' + a} icon="mapPin" label={a} aria={'Ouvrir dans Plans : ' + a} onClick={openUrl('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(a))} />),
    ...e.phones.map(p => <Chip key={'p' + p} icon="phone" label={p} aria={'Appeler le ' + p} onClick={goUrl('tel:' + p.replace(/[\s.-]/g, ''))} />),
    ...e.emails.map(m => <Chip key={'m' + m} icon="mail" label={m} aria={'Écrire à ' + m} onClick={goUrl('mailto:' + m)} />),
    ...e.urls.map(u => <Chip key={'u' + u} icon="link" label={hostOf(u)} aria={'Ouvrir ' + u} onClick={openUrl(withScheme(u))} />),
    ...e.links.map(t => {
      const target = byTitle.get(t.toLowerCase());
      if (target?.id === note.id) return null;
      return target
        ? <Chip key={'l' + t} icon="all" label={t} aria={'Ouvrir la note ' + t} onClick={() => open(target.id)} />
        : <Chip key={'l' + t} icon="plus" label={t} aria={'Créer la note ' + t} onClick={() => openLink(t)} />;
    }),
    ...back.filter(b => !e.links.some(l => l.toLowerCase() === b.title.trim().toLowerCase()))
      .map(b => <Chip key={'b' + b.id} icon="link" label={b.title} aria={'Mentionnée dans ' + b.title} onClick={() => open(b.id)} className="is-backlink" />),
  ].filter(Boolean).slice(0, 16);
  if (!chips.length) return null;
  return (
    <div className="note-found">
      <h2>Dans cette note</h2>
      <div className="chips" role="group" aria-label="Agir sur le contenu de la note">{chips}</div>
    </div>
  );
}

function Player({ att, name }: { att: Attachment; name: string }) {
  const ref = useRef<HTMLAudioElement>(null), [t, setT] = useState(0), [dur, setDur] = useState(att.duration || 0), [playing, setPlaying] = useState(false);
  const r = useStore(s => s.prefs.audioRate || 1);
  useEffect(() => {
    const a = ref.current!;
    a.playbackRate = audioRate();
    const sync = () => { setT(a.currentTime); setPlaying(!a.paused); if (isFinite(a.duration)) setDur(a.duration); };
    const events = ['timeupdate', 'loadedmetadata', 'play', 'pause', 'ended'], onPlay = () => pauseOthers(a);
    events.forEach(e => a.addEventListener(e, sync));
    a.addEventListener('play', onPlay);
    editorAudios.add(a);
    return () => { events.forEach(e => a.removeEventListener(e, sync)); a.removeEventListener('play', onPlay); a.pause(); editorAudios.delete(a); };
  }, []);
  const skip = (d: number) => { const a = ref.current!; a.currentTime = Math.max(0, Math.min(a.duration || 0, a.currentTime + d)); };
  return (
    <div className="player">
      <audio ref={ref} preload="metadata" src={urlOf(att)} />
      <button className="player-play" onClick={() => (ref.current!.paused ? ref.current!.play().catch(() => {}) : ref.current!.pause())}
        aria-label={(playing ? 'Pause' : 'Lire') + ' le message audio' + name}><Icon name={playing ? 'pause' : 'play'} /></button>
      <input className="seek" type="range" min={0} max={1000} value={dur ? Math.round((t / dur) * 1000) : 0} aria-label={'Position dans l’audio' + name}
        style={{ '--progress': (dur ? (t / dur) * 100 : 0) + '%' } as React.CSSProperties}
        onChange={e => { if (ref.current!.duration) ref.current!.currentTime = (+e.target.value / 1000) * ref.current!.duration; }} />
      <span className="player-time">{clock(Math.floor(t))}{dur ? ' / ' + clock(Math.round(dur)) : ''}</span>
      <span className="player-row">
        <button className="player-btn" onClick={() => skip(-15)} aria-label="Reculer de 15 secondes">−15 s</button>
        <button className="player-btn" onClick={cycleRate} aria-label={'Vitesse : ' + rate(r)}>{rate(r)}</button>
        <button className="player-btn" onClick={() => skip(15)} aria-label="Avancer de 15 secondes">+15 s</button>
      </span>
    </div>
  );
}

/** Live text: the words of a photo or PDF go into the note in one tap (read first if needed). */
function LiveText({ note, att, quiet }: { note: Note; att: Attachment; quiet?: boolean }) {
  const [busy, setBusy] = useState(false);
  if (att.text === '' || note.deleted) return null;   // read, and nothing in it
  const run = async () => {
    setBusy(true);
    try { addAttText(await attText(note.id, att)); } catch { toast('Lecture impossible pour ce fichier.'); } finally { setBusy(false); }
  };
  const audio = att.type === 'audio';
  return (
    <button className={quiet ? 'text-btn att-live' : 'chip glass att-live'} disabled={busy} onClick={run}
      aria-label={audio ? 'Ajouter la transcription de cet enregistrement à la note' : 'Ajouter le texte de ce fichier à la note'}>
      {!quiet && <Icon name="liveText" />}{busy ? (audio ? 'Transcription…' : 'Lecture…') : audio ? 'Ajouter la transcription' : 'Ajouter le texte'}
    </button>
  );
}

function Attachments({ note }: { note: Note }) {
  const many = note.atts.length > 1, nth = (i: number) => (many ? ' ' + (i + 1) : '');
  return (
    <div className={'atts' + (many ? ' is-multi' : '')}>
      {note.atts.map((a, i) => (
        <div key={i} className={'att att-' + a.type}>
          {a.type === 'audio' ? <><Player att={a} name={nth(i)} /><LiveText note={note} att={a} quiet /></>
            : a.type === 'pdf' ? <>
              <Icon name="doc" />
              <span className="att-pdf-text"><span className="pdf-name">{a.name || 'Document PDF'}</span><span className="pdf-meta">{pdfMeta(a)}</span></span>
              <LiveText note={note} att={a} quiet />
              <button className="text-btn" onClick={openUrl(urlOf(a))}>Ouvrir</button>
            </>
              : <><img alt={(note.title || 'Image jointe') + nth(i)} src={urlOf(a)} /><LiveText note={note} att={a} /></>}
          <button className="att-remove" onClick={() => removeAtt(i)} aria-label={'Retirer la pièce jointe' + nth(i)}><Icon name="close" /></button>
        </div>
      ))}
    </div>
  );
}

/** Aa on: the same island now holds the formatting tools (Aa first, to go back) — one row, never stacked. */
function FormatStrip({ state }: { state: FormatState | null }) {
  const level = state ? headingLevel(state.kind) : 0;
  return (
    <div className="format-strip island glass" role="toolbar" aria-label="Mise en forme">
      <button className="icon-btn format-toggle" onClick={toggleFormatBar} aria-label="Mise en forme" aria-pressed="true"><span className="glyph" aria-hidden="true">Aa</span></button>
      <span className="format-sep" aria-hidden="true" />
      {FORMAT_TOOLS.map(t => {
        const heading = t.id === 'heading', label = heading && level ? `${t.label} (niveau ${level})` : t.label;
        const on = !!state && (heading ? level > 0 : (t.id === 'card' ? state.card : state.kind === t.id || state.marks.includes(t.id as never)));
        return (
          <button key={t.id} className="icon-btn" onClick={() => applyFormat(t.id)} aria-label={label} aria-pressed={on} title={finePointer() ? `${label} (${MOD}${t.keys})` : undefined}>
            {t.icon ? <Icon name={t.icon} /> : <span className={'glyph glyph-' + t.id} aria-hidden="true">{t.glyph}{heading && level ? <sub>{level}</sub> : null}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Where a tap on the formatted view lands in the source: [line, offset in rendered text, line top]. */
function tapTarget(target: HTMLElement, x: number, y: number): [number | null, number?, number?] {
  const line = target.closest<HTMLElement>('[data-line]');
  if (!line) return [null];
  const index = +line.dataset.line!, top = line.getBoundingClientRect().top - line.closest('#note-view')!.getBoundingClientRect().top;
  const doc = document as Document & { caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  const pos = doc.caretPositionFromPoint?.(x, y), range = pos ? null : document.caretRangeFromPoint?.(x, y);
  const node = pos ? pos.offsetNode : range?.startContainer, offset = pos ? pos.offset : range?.startOffset || 0;
  if (!node || !line.contains(node)) return [index, undefined, top];
  const r = document.createRange();
  r.setStart(line, 0);
  r.setEnd(node, offset);
  return [index, r.toString().length, top];
}

function revealQuery(query: string, reading: boolean) {
  const q = query.trim().toLowerCase();
  if (!q) return;
  if (reading) return document.querySelector('#note-view mark')?.scrollIntoView({ block: 'center' });
  const el = editorRefs.body!, at = el.value.toLowerCase().indexOf(q);
  if (at < 0) return;
  el.setSelectionRange(at, at + q.length);
  if (finePointer()) el.focus({ preventScroll: true });
}

export function Editor() {
  const live = useStore(openNote), last = useRef<Note | null>(null);
  if (live) last.current = live;
  const note = live || last.current;
  const s = useStore(useShallow(s => ({
    reading: s.editor.reading, attWarn: s.editor.attWarn, focus: s.editor.focus, query: s.query, sheet: !!s.sheet, formatBar: !!s.prefs.formatBar,
  })));
  const title = useRef<HTMLInputElement>(null), body = useRef<HTMLTextAreaElement>(null);
  const [selected, setSelected] = useState(false), [format, setFormat] = useState<FormatState | null>(null);

  useEffect(() => { editorRefs.title = title.current; editorRefs.body = body.current; }, []);
  useEffect(() => {
    if (!s.focus) return;
    if (s.focus === 'title') title.current!.focus();
    else revealQuery(s.query, s.reading);
    patchEditor({ focus: null });
  }, [s.focus]);
  useLayoutEffect(() => {
    const keep = editorRefs.keep, view = document.getElementById('note-view');
    editorRefs.keep = null;
    const line = keep && view?.querySelector(`[data-line="${keep.line}"]`);
    if (line) view!.scrollTop += line.getBoundingClientRect().top - view!.getBoundingClientRect().top - keep!.top;
  }, [s.reading]);
  useEffect(() => {
    const sync = () => {
      const el = body.current!, f = caretFormat();
      setSelected(document.activeElement === el && el.selectionEnd > el.selectionStart);
      setFormat(prev => (JSON.stringify(prev) === JSON.stringify(f) ? prev : f));
    };
    document.addEventListener('selectionchange', sync);
    return () => document.removeEventListener('selectionchange', sync);
  }, []);

  // Formatting shows while writing (text focused), when Aa is on; reading shows the note tools
  const trashed = !!note?.deleted, formatting = s.formatBar && !trashed && !s.reading, words = note ? wordCount(note.body) : 0;
  const blank = !!note && !trashed && !note.body && !note.atts.length;
  const daysLeft = note?.deletedAt ? Math.max(1, Math.ceil((note.deletedAt + CONFIG.trashDays * DAY - Date.now()) / DAY)) : 0;

  const onViewClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('.check-hit, .note-found') || trashed) return;
    const link = t.closest('.wiki-link');
    if (link) return openLink(link.textContent || '');
    const tag = t.closest<HTMLElement>('.md-tag');
    if (tag) { if (!matchMedia(CONFIG.splitMedia).matches) closeEditor(); return setTab('t:' + tag.dataset.tag); }
    editAt(...tapTarget(t, e.clientX, e.clientY));
  };

  return (
    <section className={'editor' + (live ? ' open' : '') + (blank ? ' is-blank' : '')} id="editor" role="dialog" aria-label="Modifier la note" inert={s.sheet || !live || undefined}>
      <div className="editor-head">
        {note && !trashed && <SaveStatus key={note.id} />}
        <span className="editor-grabber" aria-hidden="true" />
        <button className="icon-btn split-only" onClick={closeEditor} aria-label="Fermer la note"><Icon name="close" /></button>
      </div>
      <div className="editor-body">
        {note && !trashed && (
          <button className="folder-chip" onClick={openPicker} aria-haspopup="dialog" aria-label={'Dossier : ' + (note.folder || 'aucun') + '. Déplacer'}>
            {note.folder ? <FolderTag folder={note.folder} /> : <><Icon name="folder" />Sans dossier</>}
          </button>
        )}
        <input className="editor-title" ref={title} placeholder="Titre" aria-label="Titre" value={note?.title || ''} readOnly={trashed}
          onChange={e => editField('title', e.target.value)} />
        <p className="editor-meta">
          {[trashed && note?.folder && <FolderTag key="f" folder={note.folder} />, words > 0 && plural(words, 'mot', 'mots')]
            .filter(Boolean).map((x, i) => <Fragment key={i}>{i > 0 && ' · '}{x}</Fragment>)}
        </p>
        {note && <Tools note={note} />}
        {trashed && <div className="notice">Cette note est dans la corbeille.{daysLeft ? ' Suppression définitive dans ' + plural(daysLeft, 'jour', 'jours') + '.' : ''} ⋮ pour la restaurer.</div>}
        {s.attWarn && <div className="notice alert" role="alert">Fichier volumineux : l’application peut ralentir.</div>}
        {note && note.atts.length > 0 && <Attachments note={note} />}
        <textarea className="editor-text" ref={body} placeholder="Écrire quelque chose…" aria-label="Note" hidden={s.reading} value={note?.body || ''} readOnly={trashed}
          onChange={e => editField('body', e.target.value)} onKeyDown={onEditorKey} onBlur={backToReading} />
        {blank && <>
          <div className="starters" role="group" aria-label="Commencer par">
            {TEMPLATES.map(t => (
              <button key={t.id} className="starter" onPointerDown={e => e.preventDefault()} onClick={() => applyTemplate(t.id)}><Icon name={t.icon} />{t.label}</button>
            ))}
          </div>
          <div className="editor-blank-fill" aria-hidden="true" onClick={() => (s.reading ? editAt(null) : body.current?.focus())} />
        </>}
        {s.reading && note && (
          <div className="editor-text editor-view" id="note-view" tabIndex={0} role="document" aria-label="Note mise en forme : Entrée pour modifier"
            onKeyDown={e => { if (e.key === 'Enter' && !e.defaultPrevented && e.target === e.currentTarget) { e.preventDefault(); editAt(null); } }}
            onClick={onViewClick}>
            <Formatted body={note.body} query={s.query} lines onToggle={toggleOpenCheck} />
            <Found note={note} />
          </div>
        )}
      </div>
      <div className="editor-dock" id="format-bar">
        <div className="thumb-row">
          {formatting ? <FormatStrip state={format} /> : !trashed && (
            <div className="island glass" role="toolbar" aria-label="Outils de la note">
              <button className="icon-btn" onClick={toggleFormatBar} aria-label="Mise en forme" aria-pressed="false"><span className="glyph" aria-hidden="true">Aa</span></button>
              <button className="icon-btn" onClick={() => applyFormat('check')} aria-label="Case à cocher" aria-pressed={format?.kind === 'check'}><Icon name="checklist" /></button>
              <button className="icon-btn" onClick={() => openImport('open')} aria-label="Joindre une photo, un audio ou un PDF" aria-haspopup="dialog"><Icon name="attach" /></button>
              {selected && !s.reading && <button className="icon-btn" onClick={extractSelection} aria-label="Créer une note avec la sélection"><Icon name="extract" /></button>}
            </div>
          )}
          <div className="thumb-group">
            {!formatting && (
              <div className="island glass">
                <button className="icon-btn" id="note-more" onClick={() => note && openNoteMenu(note.id)} aria-label="Plus : épingler, déplacer, rappel, partager…" aria-haspopup="dialog"><Icon name="more" /></button>
              </div>
            )}
            <button className="fab split-hidden" onClick={closeEditor} aria-label="Terminé"><Icon name="check" /></button>
          </div>
        </div>
      </div>
    </section>
  );
}
