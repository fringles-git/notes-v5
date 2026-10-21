import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import './styles/tokens.css';
import './styles/app.css';
import './styles/looks.css';
import '@fontsource-variable/sora';
import '@fontsource-variable/manrope';
import '@fontsource-variable/work-sans';
import '@fontsource/instrument-serif';
import { CONFIG } from './config';
import { releaseUrls } from './media';
import { set, useStore, type BeforeInstallPromptEvent } from './store';
import { checkTab, toast } from './actions';
import { analyse, boot, persistStorage, updateBadge } from './features';
import { bindGestures } from './gestures';
import { Dock } from './ui/Dock';
import { Editor } from './ui/Editor';
import { FileInputs } from './ui/Files';
import { LayerHost } from './ui/Layers';
import { Library } from './ui/Library';
import { Header, InfoBar, NoteList, Recap } from './ui/List';
import { PrintArea, SheetHost, Toast } from './ui/Sheets';
import { Tour, Welcome } from './ui/Welcome';

const wide = matchMedia(CONFIG.splitMedia);
const useWide = () => useSyncExternalStore(cb => { wide.addEventListener('change', cb); return () => wide.removeEventListener('change', cb); }, () => wide.matches);

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !isSecureContext || import.meta.env.DEV) return;
  navigator.serviceWorker.register(new URL('sw.js', location.href).href, { updateViaCache: 'none' }).then(reg => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    const offer = (w: ServiceWorker) => toast('Nouvelle version disponible.', () => { swap = true; w.postMessage('skip-waiting'); }, 'Recharger', 'new');
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing!;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
  }).catch(() => {});
  // Reload only for an update the user accepted — never when the very first worker takes control (first visit)
  let swap = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (swap) { swap = false; location.reload(); } });
}

function useInstall() {
  useEffect(() => {
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    set(s => ({ install: { ...s.install, ios, standalone } }));
    const onPrompt = (e: Event) => { e.preventDefault(); set(s => ({ install: { ...s.install, prompt: e as BeforeInstallPromptEvent } })); };
    const onInstalled = () => { set(s => ({ install: { ...s.install, prompt: null } })); toast('Notes est installée.'); };
    addEventListener('beforeinstallprompt', onPrompt);
    addEventListener('appinstalled', onInstalled);
    if (standalone) persistStorage();
    registerServiceWorker();
    return () => { removeEventListener('beforeinstallprompt', onPrompt); removeEventListener('appinstalled', onInstalled); };
  }, []);
}

/** Mirrors preferences and modes onto <html>/<body> for CSS. */
function useDocumentState() {
  const s = useStore(useShallow(s => ({
    theme: s.prefs.theme, look: s.prefs.look ?? 'glass', accent: s.prefs.accent ?? 'amber', hand: s.prefs.hand, tint: s.prefs.tint, editing: s.editor.id !== null,
    selecting: s.selecting, searching: s.searchOpen, recording: s.recorder.on, layer: !!s.layer.mode || !!s.sheet, notes: s.notes,
    sheet: !!s.sheet || s.welcome, ready: s.ready,
  })));
  useLayoutEffect(() => {
    const root = document.documentElement, body = document.body;
    if (s.ready) {   // until the saved prefs load, <html> keeps what the pre-paint script set
      if (s.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = s.theme;
      root.dataset.look = s.look;
      if (s.accent === 'amber') delete root.dataset.accent; else root.dataset.accent = s.accent;
    }
    Object.assign(body.dataset, { hand: s.hand, tint: s.tint });
    body.classList.toggle('is-editing', s.editing);
    body.classList.toggle('is-selecting', s.selecting);
    body.classList.toggle('is-searching', s.searching);
    body.classList.toggle('is-recording', s.recording);
    body.classList.toggle('layer-open', s.layer);
    body.classList.toggle('sheet-open', s.sheet);
  });
  useEffect(() => { checkTab(); releaseUrls(s.notes); updateBadge(s.notes); }, [s.notes]);
  // The pre-paint script in __root.tsx reads these back: the next visit opens in the right look, without a flash
  useEffect(() => {
    if (s.ready) try { localStorage.setItem('notes:look', s.look); localStorage.setItem('notes:accent', s.accent); localStorage.setItem('notes:theme', s.theme); } catch { /* private mode: the look applies once the app loads */ }
  }, [s.ready, s.look, s.accent, s.theme]);
}

export function App() {
  useEffect(bindGestures, []);
  useInstall();
  useDocumentState();
  const isWide = useWide();
  const s = useStore(useShallow(s => ({ ready: s.ready, editing: s.editor.id !== null, sheet: s.sheet, page: s.page, welcome: s.welcome })));
  if (!s.ready) return null;
  const covered = (s.editing && !isWide) || !!s.sheet;
  return (
    <>
      {s.welcome && <div className="ambient" aria-hidden="true" />}
      <div className="page" inert={covered || undefined}>
        {s.page === 'library' ? <Library /> : <>
          <Header />
          <Recap />
          <InfoBar />
          <NoteList onShown={analyse} />
        </>}
      </div>
      <div inert={covered || undefined}><Dock /></div>
      <FileInputs />
      <Editor />
      <LayerHost />
      <SheetHost />
      <Welcome />
      <Tour />
      <Toast />
      <PrintArea />
    </>
  );
}

boot();
