/** Menus and panels that open over the list or the note, beside the control that called them: create, note menu, pickers, PIN… */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { LayerMode, Note } from '../types';
import { KIND_ICON, KIND_TONE } from '../config';
import { checkStats, entities, noteTools, outline, stripCheck } from '../markdown';
import { folderColor, get, menuNote, openNote, readableNotes, tabFolder, tabLabel, useStore, type State } from '../store';
import {
  clearChecked, closeLayer, createAndOpen, dailyNote, menuDeleteForever, menuHide, menuPin,
  menuRestore, menuTrash, moveSelection, moveTo, openLayer, openPicker, patchLayer, resetPin, restoreVersion,
  setPref, submitPin, toggleNewFolder, uncheckList, unlockWithDevice, editorRefs,
} from '../actions';
import { clearReminder, toggleRecording, mergeSelection, openMap, pasteClipboard, reminderToCalendar, setReminder, shareLinkOne, shareOne, shareSelection, startStudy } from '../features';
import { caretTop, day, dayOrTime, dayTime, finePointer, plural, reducedMotion, wide } from '../utils';
import { InlineForm, Layer, NewFolder, Option, Row } from './kit';
import { Icon } from './icons';
import { pickFile } from './Files';

const Title = ({ children }: { children: React.ReactNode }) => <p className="layer-title">{children}</p>;
const Hint = ({ children }: { children: React.ReactNode }) => <p className="layer-hint">{children}</p>;

function TabRow({ tab, trailing, pressed, onClick }: { tab: string; trailing?: React.ReactNode; pressed?: boolean; onClick: () => void }) {
  const color = useStore(s => (tabFolder(tab) ? folderColor(tabFolder(tab), s.folderColors) : undefined));
  return <Row icon={KIND_ICON[tab] || { f: 'folder', t: 'hash', c: 'filter' }[tab[0]] || 'folder'} label={tabLabel(tab)} trailing={trailing} pressed={pressed} color={color} tone={KIND_TONE[tab]} onClick={onClick} />;
}

/* ---------- Create (+) ---------- */
/** + : three ways to capture, the most frequent (Note) nearest the thumb. Icons speak for themselves. */
function Create() {
  const tile = (id: string, icon: string, tone: string, label: string, onClick: () => void) => (
    <button className="tile" id={'create-' + id} data-tone={tone} onClick={onClick}>
      <Icon name={icon} /><b>{label}</b>
    </button>
  );
  return (
    <>
      <Title>Créer</Title>
      <div className="tiles" role="group" aria-label="Nouvelle note">
        {tile('import', 'download', 'blue', 'Importer', () => { useStore.setState({ importTarget: 'new' }); openLayer('import'); })}
        {tile('mic', 'mic', 'red', 'Vocal', () => { closeLayer(); toggleRecording(); })}
        {tile('note', 'edit', 'yellow', 'Note', () => { closeLayer(); createAndOpen(); })}
      </div>
      <Row icon="calendar" label="Note du jour" trailing={day(Date.now())} onClick={dailyNote} />
    </>
  );
}

function Import() {
  const attach = useStore(s => s.importTarget === 'open'), pick = (kind: Parameters<typeof pickFile>[0]) => () => { closeLayer(); pickFile(kind); };
  return (
    <>
      <Title>{attach ? 'Joindre' : 'Importer'}</Title>
      <Hint>{attach ? 'Le fichier est ajouté à cette note.' : 'Le contenu devient une nouvelle note.'}</Hint>
      <Row icon="image" label="Une image" onClick={pick('image')} />
      <Row icon="camera" label="Une photo" onClick={pick('photo')} />
      <Row icon="audio" label="Un fichier audio" onClick={pick('audio')} />
      <Row icon="doc" label="Un PDF" onClick={pick('pdf')} />
      {!attach && <>
        <Row icon="paste" label="Le presse-papiers" onClick={pasteClipboard} />
        <hr />
        <Row icon="all" label="Des fichiers texte" trailing="Markdown, EPUB" onClick={pick('text')} />
        {'webkitdirectory' in document.createElement('input') && !/iPhone|iPad/.test(navigator.userAgent) &&
          <Row icon="folder" label="Un dossier de notes" trailing="Obsidian…" onClick={pick('folder')} />}
      </>}
    </>
  );
}

/* ---------- Note menu ---------- */
function NoteTools({ note }: { note: Note }) {
  const { heads, cards, due, done, linked } = noteTools(note, useStore(readableNotes));
  return (
    <>
      {heads > 1 && <Row icon="outline" label="Plan" trailing={plural(heads, 'titre', 'titres')} onClick={() => openLayer('outline')} />}
      {cards > 0 && <Row icon="study" label="Réviser" trailing={due ? due + ' à revoir' : plural(cards, 'carte', 'cartes')} onClick={() => { closeLayer(); startStudy([note]); }} />}
      {linked && <Row icon="graph" label="Carte des liens" onClick={() => { closeLayer(); openMap(note.id); }} />}
      {done > 0 && <Row icon="listReset" label="Éléments cochés" trailing={String(done)} onClick={() => openLayer('list-actions')} />}
      {note.versions.length > 0 && <Row icon="history" label="Historique" trailing={plural(note.versions.length, 'version', 'versions')} onClick={() => openLayer('history')} />}
    </>
  );
}
function NoteMenu() {
  const s = useStore(useShallow(s => ({ note: menuNote(s), open: s.editor.id })));
  const n = s.note;
  if (!n) return null;
  const inEditor = n.id === s.open, remind = !!n.remind && !n.remindDone;
  if (n.deleted) return (
    <>
      <Title>{n.title || 'Sans titre'}</Title>
      <Row icon="restore" label="Restaurer" onClick={menuRestore} />
      <Row className="row danger" icon="trash" label="Supprimer définitivement" onClick={menuDeleteForever} />
    </>
  );
  return (
    <>
      <Title>{n.title || 'Sans titre'}</Title>
      <Row icon="pin" label={n.pinned ? 'Désépingler' : 'Épingler'} onClick={menuPin} />
      <Row icon="folder" label="Déplacer" trailing={n.folder || 'Sans dossier'} onClick={openPicker} />
      {inEditor && <Row icon="bell" label="Rappel" trailing={remind ? dayTime(n.remind!) : undefined} onClick={() => openLayer('remind')} />}
      <Row icon="share" label="Partager" onClick={() => { closeLayer(); shareOne(n); }} />
      <Row icon="link" label="Envoyer un lien" trailing="sans serveur" onClick={() => { closeLayer(); shareLinkOne(n); }} />
      <Row icon="lock" label={n.locked ? 'Ne plus masquer' : 'Masquer'} onClick={menuHide} />
      {inEditor && <><hr /><NoteTools note={n} /></>}
      <hr />
      <Row className="row danger" icon="trash" label="Supprimer" onClick={menuTrash} />
    </>
  );
}

function ListActions() {
  const done = useStore(s => checkStats(openNote(s)?.body || '').done);
  return (
    <>
      <Title>Liste</Title>
      <Hint>{plural(done, 'élément coché', 'éléments cochés')}.</Hint>
      <Row icon="listReset" label="Tout décocher" trailing="liste réutilisable" onClick={uncheckList} />
      <Row icon="trash" label="Supprimer les éléments cochés" onClick={clearChecked} />
    </>
  );
}

const IosInstall = () => (
  <>
    <Title>Garder vos notes sur iPhone</Title>
    <Hint>Safari peut effacer les données d’un site non installé après 7 jours sans visite. Installée sur l’écran d’accueil, l’app garde vos notes.</Hint>
    <ol className="steps">
      <li>Touchez <b>Partager</b> en bas de Safari</li>
      <li>Choisissez <b>Sur l’écran d’accueil</b></li>
      <li>Ouvrez Notes depuis la nouvelle icône</li>
    </ol>
    <div className="layer-foot end"><button className="text-btn" onClick={() => { setPref('iosInstallDismissed', true); closeLayer(); }}>Ne plus afficher</button></div>
  </>
);

function Picker() {
  const s = useStore(useShallow(s => ({ folders: s.folders, newFolder: s.layer.newFolder, selecting: s.selecting, current: (menuNote(s) || openNote(s))?.folder })));
  const here = (t: string) => !s.selecting && s.current !== undefined && (t === 'none' ? !s.current : s.current === tabFolder(t));
  const row = (t: string) => <TabRow key={t} tab={t} pressed={here(t)} onClick={() => moveTo(tabFolder(t))} />;
  return (
    <>
      <Title>Déplacer vers</Title>
      {row('none')}
      <hr />
      {s.folders.map(f => row('f:' + f))}
      <hr />
      {s.newFolder ? <NewFolder /> : <div className="layer-foot end"><button className="icon-btn" onClick={toggleNewFolder} aria-label="Nouveau dossier"><Icon name="folderNew" /></button></div>}
    </>
  );
}

/* ---------- PIN, reminder, history, selection, outline, view ---------- */
const PIN_TEXT = {
  new: { title: (has: boolean) => (has ? 'Nouveau code PIN' : 'Créer un code PIN'), hint: '4 à 8 chiffres. Il ouvre les notes masquées : leur contenu est chiffré sur cet appareil.' },
  auth: { title: () => 'Notes masquées', hint: 'Saisissez votre code PIN.' },
  change: { title: () => 'Changer le code PIN', hint: 'Saisissez d’abord le code actuel.' },
};
function Pin() {
  const s = useStore(useShallow(s => ({ step: s.layer.pinStep || 'auth', armed: s.layer.resetArmed, has: !!s.pinHash, hidden: s.notes.filter(n => n.locked).length, device: !!s.vault?.device })));
  const t = PIN_TEXT[s.step], device = s.step === 'auth' && s.device;
  return (
    <>
      <p className="layer-title" id="pin-title">{t.title(s.has)}</p>
      <Hint>{device ? 'Face ID ou empreinte, ou votre code PIN.' : t.hint}</Hint>
      {device && <button className="btn primary pin-device" onClick={unlockWithDevice}><Icon name="biometric" />Face ID ou empreinte</button>}
      <InlineForm key={s.step} autoFocus={!device} button="Valider" onSubmit={async (v, input) => { if (!(await submitPin(v))) { input.value = ''; input.focus(); } }}
        inputProps={{ className: 'pin-input', type: 'password', inputMode: 'numeric', maxLength: 8, autoComplete: 'off', 'aria-labelledby': 'pin-title' }} />
      {s.step !== 'new' && <>
        <div className="layer-foot">
          <button className="text-btn" onClick={() => patchLayer({ pinStep: s.step === 'auth' ? 'change' : 'auth', resetArmed: false })}>{s.step === 'auth' ? 'Changer le code' : 'Retour'}</button>
          <button className={'text-btn' + (s.armed ? ' armed' : '')} onClick={resetPin}>
            {s.armed ? (s.hidden ? 'Effacer ' + plural(s.hidden, 'note', 'notes') + ' ?' : 'Confirmer ?') : 'Code oublié ?'}
          </button>
        </div>
        {s.armed && <Hint>{s.hidden ? 'Réinitialiser efface définitivement les notes masquées.' : 'Aucune note masquée ne sera perdue.'}</Hint>}
      </>}
    </>
  );
}
function Remind() {
  const n = useStore(openNote);
  if (!n) return null;
  const now = new Date(), at = (days: number, h: number) => { const d = new Date(now); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d; };
  const inNote: [string, Date][] = entities(n).dates.filter(d => +d.start > Date.now()).slice(0, 2)
    .map(d => [d.hasTime ? 'Dans la note' : 'Dans la note, 9:00', d.hasTime ? d.start : new Date(new Date(d.start).setHours(9))]);
  const presets: [string, Date][] = [['Demain matin', at(1, 9)], ['Lundi matin', at((8 - now.getDay()) % 7 || 7, 9)]];
  if (now.getHours() < 17) presets.unshift(['Ce soir', at(0, 18)]);
  return (
    <>
      <Title>Rappel</Title>
      <Hint>Notes vous prévient tant qu’elle est ouverte. Ajoutez le rappel à l’agenda pour être prévenu partout.</Hint>
      {[...inNote, ...presets].map(([label, d]) => <Row key={label + +d} icon="bell" label={label} trailing={dayTime(+d)} onClick={() => setReminder(+d)} />)}
      <InlineForm autoFocus={false} button="Valider le rappel" onSubmit={v => setReminder(v ? new Date(v).getTime() : 0)}
        inputProps={{ type: 'datetime-local', 'aria-label': 'Date et heure du rappel' }} />
      {!!n.remind && !n.remindDone && (
        <div className="layer-foot"><button className="text-btn" onClick={clearReminder}>Retirer</button><button className="text-btn" onClick={reminderToCalendar}>Ajouter à l’agenda</button></div>
      )}
    </>
  );
}
function History() {
  const versions = useStore(s => openNote(s)?.versions || []);
  return (
    <>
      <Title>Historique</Title>
      <Hint>Une version est gardée chaque fois que la note change (10 au plus).</Hint>
      {versions.map((v, i) => (
        <Row key={i} icon="history" label={v.body.split('\n').map(l => stripCheck(l).trim()).find(Boolean) || v.title || 'Vide'} trailing={dayOrTime(v.t)} onClick={() => restoreVersion(i)} />
      ))}
    </>
  );
}
function SelMore() {
  const few = useStore(s => s.selection.size < 2);
  return (
    <>
      <Row icon="move" label="Déplacer vers un dossier" onClick={moveSelection} />
      <Row icon="merge" label="Fusionner en une note" onClick={mergeSelection} disabled={few} trailing={few ? '2 notes minimum' : undefined} />
      <Row icon="share" label="Partager" onClick={shareSelection} />
    </>
  );
}
function goToLine(line: number) {
  if (!wide()) closeLayer();   // beside the note (inspector), the plan stays open while you jump around
  if (get().editor.reading) return document.querySelector(`#note-view [data-line="${line}"]`)?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  const el = editorRefs.body;
  if (!el) return;
  const at = el.value.split('\n').slice(0, line).join('\n').length + +!!line;
  el.setSelectionRange(at, at);
  el.scrollTop = caretTop(el, at) - parseFloat(getComputedStyle(el).paddingTop);
  if (finePointer()) el.focus({ preventScroll: true });
}
function Outline() {
  const body = useStore(s => openNote(s)?.body || ''), heads = useMemo(() => outline(body), [body]);
  return <><Title>Plan</Title>{heads.map(h => <Row key={h.line} className={'row row-h' + h.level} icon="outline" label={h.text} onClick={() => goToLine(h.line)} />)}</>;
}
function Sort() {
  return (
    <>
      <Title>Trier</Title>
      <h4>Par</h4>
      <Option pref="sort" value="updated" label="Dernière modification" />
      <Option pref="sort" value="created" label="Date de création" />
      <hr />
      <h4>Ordre</h4>
      <Option pref="dir" value="desc" label="Récentes d’abord" />
      <Option pref="dir" value="asc" label="Anciennes d’abord" />
    </>
  );
}

const LAYERS: Record<LayerMode, { label: string; Content: () => React.ReactNode }> = {
  create: { label: 'Créer', Content: Create },
  'note-menu': { label: 'Actions de la note', Content: NoteMenu },
  import: { label: 'Importer', Content: Import },
  'list-actions': { label: 'Actions de la liste', Content: ListActions },
  'ios-install': { label: 'Installer sur iPhone', Content: IosInstall },
  picker: { label: 'Choisir un dossier', Content: Picker },
  pin: { label: 'Code PIN', Content: Pin },
  remind: { label: 'Rappel', Content: Remind },
  history: { label: 'Historique des versions', Content: History },
  'sel-more': { label: 'Plus d’actions', Content: SelMore },
  outline: { label: 'Plan de la note', Content: Outline },
  sort: { label: 'Trier', Content: Sort },
};

export function LayerHost() {
  const mode = useStore((s: State) => s.layer.mode), def = mode ? LAYERS[mode] : null;
  return (
    <Layer open={!!mode} onClose={closeLayer} label={def?.label || ''} className="layer glass"
      anchor inspector={mode === 'outline' || mode === 'history'} data={{ 'data-mode': mode || undefined }}>
      {def && <def.Content />}
    </Layer>
  );
}

