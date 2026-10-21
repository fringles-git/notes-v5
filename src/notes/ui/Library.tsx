/** The Library: a page like the note list — a title, the dock stays — with views, folders, tags and collections as tiles. */
import { useShallow } from 'zustand/react/shallow';
import { FOLDER_COLORS, KIND_ICON, KIND_TONE, KINDS } from '../config';
import { entities, tagsOf } from '../markdown';
import { countIn, folderColor, get, tabLabel, useStore } from '../store';
import {
  deleteCollection, deleteFolder, patchLayer, renameCollection, renameFolder, setFolderColor, setTab, toggleEditFolders, toggleNewFolder,
} from '../actions';
import { openMap } from '../features';
import { plural } from '../utils';
import { InlineForm, NewFolder, shown } from './kit';
import { Icon } from './icons';

function FolderEditRow({ folder }: { folder: string }) {
  const s = useStore(useShallow(s => ({ renaming: s.layer.renaming === folder, coloring: s.layer.coloring === folder, color: folderColor(folder, s.folderColors) })));
  if (s.renaming) return <InlineForm onSubmit={renameFolder} button="Valider le nouveau nom" inputProps={{ defaultValue: folder, 'aria-label': 'Nouveau nom du dossier' }} />;
  return (
    <>
      <div className="row row-static" data-color={s.color}>
        <button className="icon-btn row-color" onClick={() => patchLayer({ coloring: s.coloring ? null : folder, renaming: null })} aria-expanded={s.coloring}
          aria-label={`Couleur de ${folder} : ${FOLDER_COLORS[s.color - 1]}`}><Icon name="folder" /></button>
        <span className="row-label">{folder}</span>
        <span className="row-actions">
          <button className="icon-btn" onClick={() => patchLayer({ renaming: folder })} aria-label={'Renommer ' + folder}><Icon name="edit" /></button>
          <button className="icon-btn danger-text" onClick={() => deleteFolder(folder)} aria-label={'Supprimer le dossier ' + folder}><Icon name="trash" /></button>
        </span>
      </div>
      {s.coloring && (
        <div className="swatches" role="group" aria-label={'Couleur de ' + folder}>
          {FOLDER_COLORS.map((c, i) => (
            <button key={c} className="swatch" data-color={i + 1} onClick={() => setFolderColor(folder, i + 1)} aria-pressed={s.color === i + 1} aria-label={c}><Icon name="check" /></button>
          ))}
        </div>
      )}
    </>
  );
}
function CollectionEditRow({ name }: { name: string }) {
  const renaming = useStore(s => s.layer.renaming === 'c:' + name);
  if (renaming) return <InlineForm onSubmit={v => renameCollection(name, v)} button="Valider le nouveau nom" inputProps={{ defaultValue: name, 'aria-label': 'Nouveau nom de la collection' }} />;
  return (
    <div className="row row-static">
      <Icon name="filter" />
      <span className="row-label">{name}</span>
      <span className="row-actions">
        <button className="icon-btn" onClick={() => patchLayer({ renaming: 'c:' + name })} aria-label={'Renommer ' + name}><Icon name="edit" /></button>
        <button className="icon-btn danger-text" onClick={() => deleteCollection(name)} aria-label={'Supprimer la collection ' + name}><Icon name="trash" /></button>
      </span>
    </div>
  );
}

export function Library() {
  const s = useStore(useShallow(s => ({
    tab: s.prefs.tab, folders: s.folders, newFolder: s.layer.newFolder, edit: s.layer.editFolders, unlocked: s.hiddenUnlocked,
    notes: s.notes, collections: s.prefs.collections, colors: s.folderColors,
  })));
  const state = get(), live = s.notes.filter(n => !n.deleted && !n.locked), linked = live.some(n => entities(n).links.length);
  const views = ['all', ...KINDS.filter(k => s.tab === k || countIn(state, k) > 0)];
  const tags = new Map<string, number>();
  live.forEach(n => tagsOf(n).forEach(t => tags.set(t, (tags.get(t) || 0) + 1)));
  const top = Math.max(1, ...tags.values());
  const tile = (t: string, label = tabLabel(t), count: number | string = countIn(state, t), onClick = () => setTab(t)) => (
    <button key={t} className="lib-tile" data-tone={KIND_TONE[t]} aria-pressed={t !== 'all' && s.tab === t} onClick={onClick}>
      <Icon name={KIND_ICON[t] || 'graph'} />
      <b>{shown(count) ? count : ''}</b>
      <span>{label}</span>
    </button>
  );
  const recent = (f: string) => live.filter(n => n.folder === f).sort((a, b) => b.updated - a.updated);
  return (
    <main className="lib" id="library">
      <header className="app-header">
        <div className="header-bar">
          <h1 id="page-title">Bibliothèque</h1>
          <div className="island glass header-tools">
            <button className="icon-btn" onClick={toggleEditFolders} aria-label="Modifier les dossiers et collections" aria-pressed={s.edit}><Icon name="edit" /></button>
          </div>
        </div>
        <p className="page-sub">{plural(live.length, 'note', 'notes')}{s.folders.length ? ' · ' + plural(s.folders.length, 'dossier', 'dossiers') : ''}</p>
      </header>

      <section className="lib-section">
        <h2 className="list-heading">Vues</h2>
        <div className="lib-tiles">
          {views.map(t => tile(t))}
          {linked && tile('map', 'Carte des liens', '', () => openMap())}
        </div>
      </section>

      <section className="lib-section">
        <h2 className="list-heading">Dossiers</h2>
        {s.edit ? <div className="lib-rows">{s.folders.map(f => <FolderEditRow key={f} folder={f} />)}</div> : (
          <div className="lib-folders">
            {countIn(state, 'none') > 0 && (
              <button className="lib-folder" aria-pressed={s.tab === 'none'} onClick={() => setTab('none')}>
                <span className="lib-folder-name">{tabLabel('none')}</span><b>{countIn(state, 'none')}</b>
              </button>
            )}
            {s.folders.map(f => {
              const notes = recent(f);
              return (
                <button key={f} className="lib-folder" data-color={folderColor(f, s.colors)} aria-pressed={s.tab === 'f:' + f} onClick={() => setTab('f:' + f)}>
                  <span className="lib-folder-name">{f}</span>
                  {notes.length > 0 && <b>{notes.length}</b>}
                  <span className="lib-peek">{notes.slice(0, 2).map(n => <i key={n.id}>{n.title || 'Sans titre'}</i>)}</span>
                </button>
              );
            })}
            {!s.newFolder && <button className="lib-folder is-new" onClick={toggleNewFolder}><Icon name="folderNew" /><span>Nouveau dossier</span></button>}
          </div>
        )}
        {s.newFolder && <NewFolder />}
      </section>

      {tags.size > 0 && !s.edit && (
        <section className="lib-section">
          <h2 className="list-heading">Étiquettes</h2>
          <div className="lib-cloud">
            {[...tags].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')).map(([t, n]) => (
              <button key={t} className="lib-tag" aria-pressed={s.tab === 't:' + t} onClick={() => setTab('t:' + t)}
                style={{ '--weight': n / top } as React.CSSProperties}>#{t}{n > 1 && <small>{n}</small>}</button>
            ))}
          </div>
        </section>
      )}

      {!!s.collections?.length && (
        <section className="lib-section">
          <h2 className="list-heading">Collections</h2>
          {s.edit ? <div className="lib-rows">{s.collections.map(c => <CollectionEditRow key={c.name} name={c.name} />)}</div>
            : <div className="chips">{s.collections.map(c => <button key={c.name} className="chip" aria-pressed={s.tab === 'c:' + c.name} onClick={() => setTab('c:' + c.name)}><Icon name="filter" />{c.name}</button>)}</div>}
        </section>
      )}

      <section className="lib-section lib-tiles is-small">
        {tile('locked', tabLabel('locked'), s.unlocked ? countIn(state, 'locked') : '')}
        {countIn(state, 'trash') > 0 && tile('trash')}
      </section>
    </main>
  );
}
