/** The bottom of the screen, within thumb reach: navigation island + the + button, the in-dock search, selection and recording bars. */
import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CONFIG, SEARCH_KINDS, KIND_ICON, KIND_TONE } from '../config';
import { filterNotes, get, inTrash, KIND_TEST, tabLabel, useStore, visibleNotes } from '../store';
import {
  allSelected, clearRecents, closeSearch, deleteSelection, goHome, endSelecting, hideSelection, openSearch, pinSelection,
  restoreSelection, saveCollection, selectAll, setQuery, toggleKind, toggleLayer, goLibrary, toggleSettings,
} from '../actions';
import { cancelRecording, stopRecording } from '../features';
import { clock, finePointer, haptic, MOD, plural } from '../utils';
import { Icon } from './icons';

/** + opens Créer. Or, in one gesture: press (or hold), slide onto a choice, release — it is made. */
function Fab() {
  const open = useStore(s => s.layer.mode === 'create');
  const drag = useRef<{ x: number; y: number; on: boolean; timer: number; hit: HTMLElement | null } | null>(null), swallow = useRef(false);
  const start = () => {
    const d = drag.current;
    if (!d || d.on) return;
    d.on = true;
    if (get().layer.mode !== 'create') toggleLayer('create');
    haptic('open');
  };
  const arm = (x: number, y: number) => {
    const d = drag.current!, hit = [...document.querySelectorAll<HTMLElement>('.layer[data-mode="create"] :is(.tile, .row)')].find(t => {
      const r = t.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }) || null;
    if (hit === d.hit) return;
    d.hit?.classList.remove('is-armed');
    hit?.classList.add('is-armed');
    if (hit) haptic('threshold');
    d.hit = hit;
  };
  const end = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    clearTimeout(d.timer);
    d.hit?.classList.remove('is-armed');
    if (!d.on) return;
    swallow.current = true;   // the click that follows a slide is not a tap
    if (commit) d.hit?.click();
  };
  return (
    <button className="fab" id="fab" aria-label="Créer : note, vocal, import" aria-haspopup="dialog" aria-expanded={open} title={finePointer() ? 'Créer (N : nouvelle note)' : undefined}
      onPointerDown={e => {
        if (e.button) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, on: false, hit: null, timer: window.setTimeout(start, CONFIG.holdMs) };
      }}
      onPointerMove={e => {
        const d = drag.current;
        if (!d) return;
        if (!d.on && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) { clearTimeout(d.timer); start(); }
        if (d.on) arm(e.clientX, e.clientY);
      }}
      onPointerUp={() => end(true)} onPointerCancel={() => end(false)}
      onClick={() => { if (swallow.current) swallow.current = false; else toggleLayer('create'); }}>
      <Icon name="plus" />
    </button>
  );
}

/** One navigation island next to +, which sits on the thumb's side. */
function MainDock() {
  // Notes = every note; Bibliothèque = the library and any view picked in it (folder, tag, collection…)
  const s = useStore(useShallow(s => {
    const all = s.page === 'notes' && s.prefs.tab === 'all';
    return { home: all && !s.sheet, library: !all && !s.sheet, settings: s.sheet === 'settings' };
  }));
  const at = s.home ? 0 : s.library ? 1 : s.settings ? 3 : -1;   // Recherche (2) is a mode, never a place
  /** A destination says where you are (aria-current); a panel says whether it is open (aria-pressed). */
  const tab = (id: string, icon: string, label: string, onClick: () => void, on: boolean, popup = false, keys = '') => (
    <button className="tab-btn" id={id} onClick={onClick} title={keys && finePointer() ? `${label} (${keys})` : undefined}
      {...(popup ? { 'aria-pressed': on, 'aria-haspopup': 'dialog' as const } : { 'aria-current': on ? 'page' as const : undefined })}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  );
  return (
    <nav className="dock thumb-row main-dock" aria-label="Navigation">
      <div className="island glass" id="nav-island" style={{ '--i': Math.max(at, 0), '--n': 4 } as React.CSSProperties}>
        <span className="seg-thumb" data-off={at < 0 || undefined} aria-hidden="true" />
        {tab('nav-notes', 'all', 'Notes', goHome, s.home)}
        {tab('nav-library', 'library', 'Bibliothèque', goLibrary, s.library)}
        {tab('search-button', 'search', 'Recherche', openSearch, false, false, '/ ou ' + MOD + 'K')}
        {tab('nav-settings', 'settings', 'Réglages', toggleSettings, s.settings, true)}
      </div>
      <Fab />
    </nav>
  );
}

function SearchDock() {
  const s = useStore(useShallow(s => ({
    notes: s.notes, tab: s.prefs.tab, query: s.query, kind: s.searchKind, unlocked: s.hiddenUnlocked,
    recents: s.prefs.recentSearches, collections: s.prefs.collections,
  })));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  const kinds = SEARCH_KINDS.filter(k => {
    if (s.kind === k) return true;
    const pool = filterNotes(s.notes, { tab: s.tab, query: s.query, unlocked: s.unlocked, collections: s.collections });
    return pool.some(KIND_TEST[k]);
  });
  const where = s.tab === 'all' ? 'Notes' : tabLabel(s.tab), recents = s.query.trim() ? [] : s.recents || [];
  return (
    <div className="dock search-dock" role="search">
      <div className="search-chips" role="group" aria-label="Filtrer les résultats">
        {/* No "Tout" chip: no filter is the default; a filter chip toggles itself off */}
        {kinds.map(k => <button key={k} className="chip glass" data-tone={KIND_TONE[k]} aria-pressed={s.kind === k} onClick={() => toggleKind(k)}><Icon name={KIND_ICON[k]} />{tabLabel(k)}</button>)}
        {(s.query.trim() || s.kind) && <button className="chip glass is-quiet" onClick={saveCollection} aria-label="Enregistrer cette recherche comme collection"><Icon name="filter" />Enregistrer</button>}
        {recents.length > 0 && <span className="chip-group" role="group" aria-label="Recherches récentes">
          {recents.map(r => <button key={r} className="chip glass is-quiet" onClick={() => { setQuery(r); input.current?.focus(); }} aria-label={'Rechercher ' + r}><Icon name="history" />{r}</button>)}
          <button className="text-btn" onClick={clearRecents}>Effacer</button>
        </span>}
      </div>
      <div className="thumb-row">
        <label className="search-field island glass">
          <Icon name="search" />
          <input id="search-input" ref={input} type="search" enterKeyHint="search" placeholder={'Rechercher dans ' + where} aria-label={'Rechercher dans ' + where}
            value={s.query} onChange={e => setQuery(e.target.value)} />
          {!s.query && finePointer() && <kbd className="kbd" title="Ouvre la recherche depuis l’accueil" aria-hidden="true">{MOD}K</kbd>}
          {s.query && <button className="search-clear" onClick={() => { setQuery(''); input.current?.focus(); }} aria-label="Effacer la recherche"><Icon name="close" /></button>}
        </label>
        <button className="fab is-quiet" onClick={closeSearch} aria-label="Fermer la recherche"><Icon name="close" /></button>
      </div>
    </div>
  );
}

function SelectionDock() {
  const s = useStore(useShallow(s => {
    const picked = s.notes.filter(n => s.selection.has(n.id));
    return {
      count: s.selection.size, trash: inTrash(s), armed: s.deleteArmed, all: allSelected(s), total: visibleNotes(s).length,
      pinned: picked.length > 0 && picked.every(n => n.pinned), hidden: picked.length > 0 && picked.every(n => n.locked), more: s.layer.mode === 'sel-more',
    };
  }));
  const none = !s.count;
  const btn = (icon: string, label: string, aria: string, onClick: () => void, extra: React.ButtonHTMLAttributes<HTMLButtonElement> = {}, cls = 'action-btn') => (
    <button className={cls} onClick={onClick} aria-label={aria} {...extra}><Icon name={icon} /><span>{label}</span></button>
  );
  return (
    <nav className="dock thumb-row is-compact" aria-label="Sélection">
      <div className="island glass sel-bar" role="toolbar" aria-label="Actions de sélection">
        {btn('selectAll', s.all ? 'Aucun' : 'Tout', s.all ? 'Tout désélectionner' : 'Tout sélectionner', selectAll, { 'aria-pressed': s.all, disabled: !s.total })}
        {btn('trash', s.armed ? 'Confirmer ?' : 'Supprimer', s.armed ? 'Confirmer la suppression de ' + plural(s.count, 'note', 'notes') : s.trash ? 'Supprimer définitivement la sélection' : 'Supprimer la sélection',
          deleteSelection, { disabled: none }, 'action-btn danger' + (s.armed ? ' armed' : ''))}
        {s.trash
          ? btn('restore', 'Restaurer', 'Restaurer la sélection', restoreSelection, { disabled: none })
          : <>
            {btn('lock', s.hidden ? 'Afficher' : 'Masquer', s.hidden ? 'Afficher la sélection' : 'Masquer la sélection', hideSelection, { disabled: none })}
            {btn('pin', s.pinned ? 'Désépingler' : 'Épingler', s.pinned ? 'Désépingler la sélection' : 'Épingler la sélection', pinSelection, { disabled: none })}
            {btn('more', 'Plus', 'Plus d’actions : déplacer, fusionner, partager', () => toggleLayer('sel-more'), { disabled: none, 'aria-haspopup': 'dialog', 'aria-expanded': s.more })}
          </>}
      </div>
      <button className="fab is-quiet sel-count" onClick={endSelecting} aria-label={'Terminer la sélection (' + plural(s.count, 'note sélectionnée', 'notes sélectionnées') + ')'}>
        <span aria-live="polite">{s.count}</span><Icon name="close" />
      </button>
    </nav>
  );
}

function RecordingBar() {
  const started = useStore(s => s.recorder.startedAt), [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 500); return () => clearInterval(t); }, []);
  return (
    <div className="rec-bar island glass" role="status">
      <span className="rec-dot" aria-hidden="true" />
      <span>Enregistrement <b>{clock(Math.floor((Date.now() - started) / 1000))}</b></span>
      <button className="icon-btn" onClick={cancelRecording} aria-label="Annuler l’enregistrement"><Icon name="close" /></button>
      <button className="icon-btn stop" onClick={stopRecording} aria-label="Arrêter et garder"><Icon name="check" /></button>
    </div>
  );
}

export function Dock() {
  const s = useStore(useShallow(s => ({ searching: s.searchOpen, selecting: s.selecting, recording: s.recorder.on })));
  return (
    <>
      {s.recording && <RecordingBar />}
      {s.selecting ? <SelectionDock /> : s.searching ? <SearchDock /> : <MainDock />}
    </>
  );
}
