/** About, what's new and the guide: the sheets that read the changelog. Loaded on demand by Sheets.tsx,
 * so the release notes and the guide stay out of the app's first load. */
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ChangeKind } from '../types';
import { CREDITS, CURRENT, findRelease, GUIDE, RELEASE_LIST, releasesSince, type Release } from '../changelog';
import { CHANGE_KINDS } from '../config';
import { useStore } from '../store';
import { bytes, day, fmt, plural, time } from '../utils';
import { Formatted, Section, StateMark } from './kit';
import { Icon } from './icons';

const countChanges = (list: Release[]) => CHANGE_KINDS.map(k => ({ ...k, count: list.reduce((t, r) => t + (r.changes[k.kind]?.length || 0), 0) })).filter(k => k.count);
function releaseDate(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  if (!d) return fmt('month', { month: 'long', year: 'numeric' }).format(new Date(y, m - 1));
  const then = new Date(y, m - 1, d), today = new Date();
  today.setHours(0, 0, 0, 0);
  const ago = Math.round((+today - +then) / 864e5);
  return ago === 0 ? 'Aujourd’hui' : ago === 1 ? 'Hier' : ago > 1 && ago < 7 ? `Il y a ${ago} jours` : fmt('long', { day: 'numeric', month: 'long', year: 'numeric' }).format(then);
}
function ChangeGroup({ kind, title, items }: { kind: ChangeKind; title: string; items: string[] }) {
  const [all, setAll] = useState(items.length <= 5);
  return (
    <section className="change-group" data-kind={kind}>
      <h4><StateMark kind={kind} />{title}<span className="change-count">{items.length}</span></h4>
      <ul>{(all ? items : items.slice(0, 5)).map(i => <li key={i}>{i}</li>)}</ul>
      {!all && <button className="text-btn" onClick={() => setAll(true)}>Tout afficher ({items.length})</button>}
    </section>
  );
}
const Changes = ({ r }: { r: Release }) => <>{CHANGE_KINDS.map(k => r.changes[k.kind]?.length ? <ChangeGroup key={k.kind} kind={k.kind} title={k.title} items={r.changes[k.kind]!} /> : null)}</>;
function Timeline({ releases, open: openCount = 1 }: { releases: Release[]; open?: number }) {
  // One release: its version, date and counts are already in the summary above — straight to what changed
  if (releases.length === 1) return <div className="timeline-bare"><Changes r={releases[0]} /></div>;
  return (
    <ol className="timeline">{releases.map((r, i) => (
      <li key={r.version} className={'release' + (r === CURRENT ? ' is-installed' : '')}>
        <details open={i < openCount}>
          <summary>
            <span className="release-title"><span className="release-node" aria-hidden="true" />{r.version}{r === CURRENT && <span className="badge">Installée</span>}</span>
            <span className="release-meta">{[releaseDate(r.date), ...countChanges([r]).map(c => plural(c.count, c.one, c.many)), r.legacy && r.legacy !== r.version && 'ex-' + r.legacy].filter(Boolean).join(' · ')}</span>
          </summary>
          <Changes r={r} />
        </details>
      </li>
    ))}</ol>
  );
}
export function About() {
  const s = useStore(useShallow(s => ({ info: s.storageInfo, count: s.notes.filter(n => !n.deleted).length })));
  const built = __BUILD__.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/), when = built && new Date(Date.UTC(+built[1], +built[2] - 1, +built[3], +built[4], +built[5]));
  return (
    <>
      <div className="about-app">
        <img className="about-icon" src="icons/icon-192.png" alt="" />
        <div><p className="about-name">Notes</p><p className="about-version">Version {CURRENT.version}{when && <> · {day(when)} {time(when)}</>}</p></div>
      </div>
      <Section title="Créé par"><p className="about-text"><b>Fringles</b> · Design et développement</p></Section>
      <Section title="Vos données"><p className="about-text">Tout reste sur cet appareil, sans compte : rien n’est envoyé sur le cloud. {plural(s.count, 'note', 'notes')}{s.info ? ' · ' + bytes(s.info.used) + (s.info.persisted ? ' · stockage protégé' : '') : ''}.</p></Section>
      <Section title="Journal des modifications"><Timeline releases={RELEASE_LIST} /></Section>
      <Section title="Crédits">{CREDITS.map(([a, b]) => <p key={a} className="about-text"><b>{a}</b> · {b}</p>)}</Section>
    </>
  );
}
export function News() {
  const since = useStore(s => s.newsSince) || RELEASE_LIST[1]?.version || CURRENT.version, list = releasesSince(since);
  return (
    <>
      <div className="news">
        <p className="news-versions"><span className="version-pill">{findRelease(since)?.version}</span><Icon name="arrowRight" /><span className="version-pill is-new">{CURRENT.version}</span></p>
        <p className="news-title">{plural(list.length, 'nouvelle version', 'nouvelles versions')}</p>
        <p className="news-counts">{countChanges(list).map(c => <span key={c.kind} className="change-pill" data-kind={c.kind}><Icon name={c.icon} />{plural(c.count, c.one, c.many)}</span>)}</p>
      </div>
      <Timeline releases={list} open={list.length} />
    </>
  );
}

/** The guide, from Réglages › Aide: read like a note, kept out of the notes. */
export const Guide = () => <div className="guide-text"><Formatted body={GUIDE} /></div>;
