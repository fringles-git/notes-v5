/** First-run welcome and the guided tour (a spotlight + bubble over each tool). */
import { useEffect, useLayoutEffect, useState } from 'react';
import { TOUR } from '../config';
import { useStore } from '../store';
import { endTour, endWelcome, tourStep } from '../features';
import { cssPx } from '../utils';
import { HANDS, Layer, Segmented, THEMES } from './kit';
import { Icon } from './icons';

const Art = () => (
  <div className="welcome-art" aria-hidden="true">
    <span className="art-card glass" data-color="1"><b /><i /><i /><i /></span>
    <span className="art-card glass" data-color="3"><b /><i className="art-check" /><i className="art-check" /><i className="art-check" /></span>
    <span className="art-card glass" data-color="5"><b /><i className="art-wave" /></span>
    <span className="art-plus"><Icon name="plus" /></span>
  </div>
);
const Feature = ({ icon, title, text }: { icon: string; title: string; text: string }) => (
  <div className="welcome-feature"><Icon name={icon} /><p><b>{title}</b>{text}</p></div>
);
const STEPS = [
  () => <>
    <Art />
    <h2 className="welcome-title">Bienvenue dans Notes</h2>
    <p className="welcome-lead">Vos notes, listes, photos et messages vocaux, à portée de pouce.</p>
    <Feature icon="lock" title="Privé" text="Tout reste sur cet appareil : pas de compte, rien n’est envoyé sur le cloud." />
    <Feature icon="offline" title="Hors ligne" text="Notes s’ouvre et enregistre même sans connexion." />
    <Feature icon="hand" title="À une main" text="Tout ce qui sert souvent est en bas, sous le pouce." />
  </>,
  () => <>
    <h2 className="welcome-title">À votre main</h2>
    <p className="welcome-lead">Les boutons se rangent du côté de votre pouce. Tout se change ensuite dans Réglages.</p>
    <Segmented pref="hand" label="Main dominante" options={HANDS} />
    <Segmented pref="theme" label="Thème" options={THEMES} />
  </>,
  () => <>
    <h2 className="welcome-title">Tout est prêt</h2>
    <p className="welcome-lead">Touchez <b>+</b> pour écrire votre première note. Le guide et les nouveautés sont dans <b>Réglages › Aide</b>.</p>
    <p className="welcome-lead">La visite guidée montre en quelques étapes où se trouve chaque outil.</p>
  </>,
];

export function Welcome() {
  const open = useStore(s => s.welcome), [step, setStep] = useState(0), Step = STEPS[step], last = step === STEPS.length - 1;
  useEffect(() => { if (open) setStep(0); }, [open]);
  useEffect(() => { document.getElementById('welcome-next')?.focus(); }, [step]);
  return (
    <Layer open={open} onClose={() => endWelcome(false)} label="Bienvenue dans Notes" className="sheet glass welcome" data={{ 'data-drag': '' }}
      initialFocus={() => document.getElementById('welcome-next')}>
      <span className="sheet-grabber" aria-hidden="true" />
      <div className="sheet-head">
        <span className="dots" role="img" aria-label={`Étape ${step + 1} sur ${STEPS.length}`}>{STEPS.map((_, i) => <i key={i} data-on={i === step || undefined} />)}</span>
        <button className="text-btn" onClick={() => endWelcome(false)}>Passer</button>
      </div>
      <div className="sheet-body welcome-body"><Step /></div>
      <div className="sheet-foot">
        {last
          ? <><button className="btn" onClick={() => endWelcome(false)}>Commencer</button><button className="btn primary" id="welcome-next" onClick={() => endWelcome(true)}>Visite guidée</button></>
          : <>{step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Retour</button>}<button className="btn primary" id="welcome-next" onClick={() => setStep(step + 1)}>Continuer</button></>}
      </div>
    </Layer>
  );
}

export function Tour() {
  const index = useStore(s => s.tour), step = index === null ? null : TOUR[index], [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!step) return;
    const target = () => (step.target ? document.querySelector(step.target) : null);
    const measure = () => { const r = target()?.getBoundingClientRect(); setRect(r && r.width ? r : null); };
    target()?.scrollIntoView({ block: 'nearest' });
    measure();
    const t = setTimeout(measure, 400);
    requestAnimationFrame(() => document.getElementById('tour-next')?.focus());
    addEventListener('resize', measure);
    addEventListener('scroll', measure, true);
    return () => { clearTimeout(t); removeEventListener('resize', measure); removeEventListener('scroll', measure, true); };
  }, [step]);
  if (index === null || !step) return null;
  const last = index === TOUR.length - 1, pad = cssPx('--space-2'), edge = cssPx('--space-3'), w = Math.min(300, innerWidth - 2 * edge);
  const spot = rect && { left: rect.left - pad, top: rect.top - pad, width: rect.width + 2 * pad, height: rect.height + 2 * pad };
  const bubble = rect ? {
    left: Math.min(Math.max(edge, rect.left + rect.width / 2 - w / 2), innerWidth - w - edge),
    ...(rect.top + rect.height / 2 < innerHeight / 2 ? { top: rect.bottom + 2 * pad } : { bottom: innerHeight - rect.top + 2 * pad }),
  } : {};
  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-text" data-spot={rect ? '' : undefined}>
      {spot && <div className="tour-spot" style={spot} />}
      <div className={'tour-bubble glass' + (rect ? '' : ' is-centered')} style={{ ...bubble, width: w }}>
        <p className="tour-count">{index + 1} / {TOUR.length}</p>
        <h2 className="tour-title" id="tour-title">{step.title}</h2>
        <p className="tour-text" id="tour-text">{step.text.split('**').map((t, i) => (i % 2 ? <b key={i}>{t}</b> : t))}</p>
        <div className="tour-actions">
          {!last && <button className="text-btn" onClick={endTour}>Passer</button>}
          {index > 0 && <button className="text-btn push" onClick={() => tourStep(index - 1)}>Précédent</button>}
          <button className={'btn primary' + (index > 0 ? '' : ' push')} id="tour-next" onClick={() => tourStep(index + 1)}>{last ? 'Terminer' : 'Suivant'}</button>
        </div>
      </div>
    </div>
  );
}
