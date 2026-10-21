/** Features around the notes: capture & import, attachments analysis, audio, reminders, sharing, study, exports, onboarding, boot. */
import type { Attachment, Note, Prefs } from './types';
import type { Vault } from './vault';
import { CONFIG, CURRENT, DAY, DEFAULT_FOLDERS, HINTS, MSG, RELEASE_LIST, releasesSince, TOUR } from './config';
import { attFromBackup, backupBlob, getAll, normalizeNote, openDb } from './db';
import { dueCards, flashcards, grade, hostOf, removeCardLine, URL_RE } from './markdown';
import { audioPeaks, epubToNotes, exportPptx, fileToAtt, htmlFileToNote, isHeavy, markdownToNote, ocrText, pdfText, releaseUrls, titleFromFile, transcribe, zip } from './media';
import { get, noteById, openNote, set, tabFolder, tabLabel, tabNotes } from './store';
import {
  checkTab, closeEditor, closeLayer, closeSearch, closeSheet, createAndOpen, createNote, editNote, endSelecting, fresh, open,
  openEditor, openSheet, patchAtt, persist, refreshStorage, removeNotes, saveFolders, selectedNotes, setPref, syncLastId, toast,
  trashNotes, untrashNotes, unlock, updateNote, updateNotes, fromTemplate, dailyNote, openSearch,
} from './actions';
import { day, dayTime, download, eventDate, fileSafe, isToday, plural, shuffle } from './utils';

/* ---------- Capture: files, text, share, paste ---------- */
/** One image, audio or PDF: attached to the open note, or a new note. */
export function importFile(f?: File) {
  if (!f) return;
  const att = fileToAtt(f);
  if (!att) return toast('Format non pris en charge : choisissez une image, un fichier audio ou un PDF.');
  if (!f.size) return toast('Ce fichier est vide.');
  const heavy = isHeavy([f]), n = openNote(get());
  if (get().importTarget === 'open' && n) {
    editNote({ atts: [...n.atts, att] }, { save: 'now' });
    if (heavy) set(s => ({ editor: { ...s.editor, attWarn: true } }));
    return;
  }
  createAndOpen({ title: titleFromFile(f.name, att.type), atts: [att] }, heavy);
}

/** Markdown, text, HTML or EPUB files — or a whole folder (Obsidian vault). */
export async function importTextFiles(files: File[]) {
  const made: Pick<Note, 'title' | 'body' | 'folder'>[] = [], here = tabFolder(get().prefs.tab);
  const ensure = (f: string) => {
    if (f && !get().folders.includes(f)) { set(s => ({ folders: [...s.folders, f] })); saveFolders(); }
    return f;
  };
  for (const f of files) {
    const path = f.webkitRelativePath || f.name;
    if (path.split('/').some(p => p.startsWith('.'))) continue;
    try {
      if (/\.epub$/i.test(f.name)) {
        const book = await epubToNotes(f), folder = ensure(book.title);
        made.push(...book.chapters.map(c => ({ ...c, folder })));
      } else if (/\.(md|markdown|txt|html?)$/i.test(f.name)) {
        const text = await f.text(), note = /\.html?$/i.test(f.name) ? htmlFileToNote(f.name, text) : markdownToNote(f.name, text);
        made.push({ ...note, folder: ensure(path.split('/').slice(-2, -1)[0] || '') || here });
      }
    } catch { toast('Lecture impossible : ' + f.name); }
  }
  if (!made.length) return toast('Aucun fichier Markdown, texte ou EPUB à importer.');
  const now = Date.now(), notes = made.map((m, i) => createNote({ ...m, created: now - i, updated: now - i }));
  if (notes.length === 1) return openEditor(notes[0].id);
  toast(plural(notes.length, 'note importée', 'notes importées') + '.', () => removeNotes(fresh(notes)));
}

export function importBackup(f?: File) {
  f?.text().then(text => {
    let data: unknown;
    try { data = JSON.parse(text); } catch { return toast(MSG.badBackup); }
    const d = data as { notes?: unknown[]; folders?: unknown[]; folderColors?: Record<string, unknown> };
    const list = Array.isArray(data) ? data : Array.isArray(d?.notes) ? d.notes : null;
    if (!list) return toast(MSG.badBackup);
    let added = 0, updated = 0;
    const byId = new Map(get().notes.map(n => [n.id, n]));
    (list as Record<string, unknown>[]).filter(r => r && r.id != null).forEach(r => {
      const n = normalizeNote(r);
      n.atts = n.atts.map(attFromBackup).filter((a): a is NonNullable<typeof a> => !!a);
      const cur = byId.get(n.id);
      if (!cur) { byId.set(n.id, n); added++; persist(n).catch(() => {}); }
      else if (n.updated > cur.updated) { byId.set(n.id, n); updated++; persist(n).catch(() => {}); }
    });
    const meta = Array.isArray(data) ? {} : d;
    set(s => {
      const notes = [...byId.values()], folders = s.folders.slice(), colors = { ...s.folderColors };
      [...(Array.isArray(meta.folders) ? meta.folders : []), ...notes.map(n => n.folder)]
        .forEach(f => { if (f && typeof f === 'string' && !folders.includes(f)) folders.push(f); });
      Object.entries(meta.folderColors || {}).forEach(([k, v]) => { colors[k] ||= +(v as number) || 0; });
      return { notes, folders, folderColors: colors };
    });
    saveFolders();
    syncLastId();
    releaseUrls(get().notes);
    toast(added + updated ? plural(added, 'note ajoutée', 'notes ajoutées') + ', ' + plural(updated, 'mise à jour', 'mises à jour') : 'Rien de nouveau dans cette sauvegarde.');
  }).catch(() => toast(MSG.badBackup));
}

/** Text, a link or files from another app, the clipboard or a paste. */
export function importShared({ title = '', text = '', url = '', files = [] as File[] }) {
  const atts = files.map(fileToAtt).filter((a): a is NonNullable<typeof a> => !!a && !!a.size);
  const content = [text, url && !text.includes(url) ? url : ''].filter(Boolean).join('\n').trim();
  if (!atts.length && !content) return toast('Rien à importer : seules les images, l’audio, les PDF et le texte sont pris en charge.');
  const name = title.trim()
    || (content && !/\s/.test(content) && RegExp(URL_RE.source, 'i').test(content) ? hostOf(content)
      : !content && atts.length ? titleFromFile(files[0].name, atts[0].type) : '');
  set({ importTarget: 'new' });
  createAndOpen({ title: name, body: content, atts }, isHeavy(files));
}
export async function pasteClipboard() {
  closeLayer();
  const cb = navigator.clipboard;
  try {
    if (cb?.read) {
      const files: File[] = [], texts: string[] = [];
      for (const item of await cb.read()) {
        const media = item.types.find(t => /^(image|audio)\//.test(t));
        if (media) files.push(new File([await item.getType(media)], 'Collage', { type: media }));
        else if (item.types.includes('text/plain')) texts.push(await (await item.getType('text/plain')).text());
      }
      return importShared({ text: texts.join('\n'), files });
    }
    importShared({ text: await cb.readText() });
  } catch { toast('Presse-papiers inaccessible. Collez avec Ctrl+V ou ⌘V.'); }
}
async function sharedFiles(fields: { title: string; text: string; url: string }) {
  try {
    const cache = await caches.open('notes-share'), files: File[] = [];
    for (const req of await cache.keys()) {
      const res = (await cache.match(req))!, blob = await res.blob();
      files.push(new File([blob], decodeURIComponent(res.headers.get('X-File-Name') || 'Partage'), { type: blob.type }));
      await cache.delete(req);
    }
    importShared({ ...fields, files });
  } catch { toast('Le partage n’a pas pu être importé.'); }
}

/* ---------- Attachment analysis: waveform, PDF text, photo text ---------- */
const analysed = new WeakSet<Blob>();
export function analyse(notes: Note[]) {
  notes.forEach(n => n.atts.forEach(a => {
    if (!a.blob) return;
    const blob = a.blob, done = (p: object) => patchAtt(n.id, blob, p), retry = () => analysed.delete(blob);
    if (a.type === 'audio' && a.text == null && get().prefs.asr && !n.locked && !heard.has(blob)) {
      heard.add(blob);
      listen(blob).then(text => { done({ text }); titleFromSpeech(n.id, text); }).catch(() => heard.delete(blob));
    }
    if (analysed.has(blob)) return;
    if (a.type === 'audio' && !a.peaks && !n.locked) { analysed.add(blob); audioPeaks(blob).then(done).catch(() => {}); }
    else if (a.type === 'pdf' && a.text == null) { analysed.add(blob); pdfText(blob).then(done).catch(retry); }
    else if (a.type === 'image' && a.text == null && get().prefs.ocr && !n.locked) { analysed.add(blob); ocrText(blob).then(text => done({ text })).catch(retry); }
  }));
}
const heard = new WeakSet<Blob>();   // recordings sent to transcription this session
export function toggleAsr() {
  const on = !get().prefs.asr;
  setPref('asr', on);
  if (on) { analyse(get().notes); toast('Les notes vocales sont transcrites sur cet appareil : leur texte apparaîtra dans la recherche.'); }
}
/** Speech to text, with the one-time model download shown in a toast. */
let shownAt = 0;
const listen = (blob: Blob) => transcribe(blob, (loaded, total) => {
  if (Date.now() - shownAt < 1500 && loaded < total) return;
  shownAt = Date.now();
  toast(loaded < total ? `Modèle de transcription : ${Math.round(loaded / 1e6)} / ${Math.round(total / 1e6)} Mo (une seule fois)` : 'Modèle prêt : transcription en cours…');
});
/** A voice note titled from its first words, while it still has the default title. */
function titleFromSpeech(id: number, text: string) {
  const n = noteById(id), words = text.replace(/\s+/g, ' ').trim().split(' ').slice(0, 7).join(' ').replace(/[,;:.!?…]+$/, '');
  if (n && n.title === 'Note vocale' && !n.body.trim() && words) updateNote(n, { title: words + (text.trim().split(/\s+/).length > 7 ? '…' : '') });
}
/** Live text: the words of a photo, a PDF or a recording, read now if they were not yet (the settings may be off). */
export async function attText(noteId: number, a: Attachment) {
  if (a.text != null || !a.blob) return a.text || '';
  const text = a.type === 'image' ? await ocrText(a.blob) : a.type === 'pdf' ? (await pdfText(a.blob)).text : await listen(a.blob);
  patchAtt(noteId, a.blob, { text });
  if (a.type === 'audio') titleFromSpeech(noteId, text);
  return text;
}
/** Adds an attachment's words at the end of the open note, with undo. */
export function addAttText(text: string) {
  const n = openNote(get()), words = text.trim();
  if (!n) return;
  if (!words) return toast('Aucun texte trouvé dans ce fichier.');
  const before = n.body, body = before.trimEnd();
  editNote({ body: (body ? body + '\n\n' : '') + words + '\n' }, { save: 'now' });
  toast('Texte ajouté à la note.', () => { if (openNote(get())?.id === n.id) editNote({ body: before }, { save: 'now' }); });
}
export function toggleOcr() {
  const on = !get().prefs.ocr;
  setPref('ocr', on);
  if (on) { analyse(get().notes); toast('Les photos sont lues sur cet appareil : leur texte apparaîtra dans la recherche.'); }
}

/* ---------- Voice recording ---------- */
let recorder: MediaRecorder | null = null, cancelled = false;
export function toggleRecording() {
  if (recorder) return stopRecording();
  if (get().searchOpen) closeSearch();
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Enregistrement non pris en charge sur cet appareil.');
  navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    const chunks: Blob[] = [], type = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(t => MediaRecorder.isTypeSupported?.(t));
    const rec = (recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined));
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' });
      recorder = null;
      set({ recorder: { on: false, startedAt: 0 } });
      if (cancelled) { cancelled = false; return toast('Enregistrement annulé'); }
      if (!blob.size) return toast('Aucun son enregistré.');
      createAndOpen({ title: 'Note vocale', atts: [{ type: 'audio', blob, size: blob.size }] }, blob.size > CONFIG.attWarnBytes);
    };
    rec.start();
    set({ recorder: { on: true, startedAt: Date.now() } });
  }).catch(() => toast('Micro inaccessible. Autorisez l’accès au micro.'));
}
export function stopRecording() { if (recorder && recorder.state !== 'inactive') recorder.stop(); }
export function cancelRecording() { cancelled = true; stopRecording(); }

/* ---------- Audio playback: one sound at a time ---------- */
let cardAudio: HTMLAudioElement | null = null;
export const editorAudios = new Set<HTMLAudioElement>();
export const audioRate = () => get().prefs.audioRate || 1;
export function stopCardAudio() {
  cardAudio?.pause();
  cardAudio = null;
  set({ player: { id: null, playing: false, time: 0 } });
}
export function pauseOthers(except?: HTMLAudioElement) {
  if (cardAudio !== except) stopCardAudio();
  editorAudios.forEach(a => a !== except && a.pause());
}
export function playCard(id: number, src: string) {
  if (get().player.id === id && cardAudio) return void (cardAudio.paused ? cardAudio.play() : cardAudio.pause());
  pauseOthers();
  const a = (cardAudio = new Audio(src));
  a.playbackRate = audioRate();
  set({ player: { id, playing: false, time: 0 } });
  const sync = () => { if (cardAudio === a) set({ player: { id, playing: !a.paused, time: a.currentTime } }); };
  ['timeupdate', 'play', 'pause'].forEach(e => a.addEventListener(e, sync));
  a.addEventListener('ended', stopCardAudio);
  a.play().catch(() => { stopCardAudio(); toast('Lecture impossible pour ce fichier.'); });
}
export function cycleRate() {
  const r = CONFIG.audioRates, next = r[(r.indexOf(audioRate() as (typeof r)[number]) + 1) % r.length];
  setPref('audioRate', next);
  editorAudios.forEach(a => { a.playbackRate = next; });
  if (cardAudio) cardAudio.playbackRate = next;
}

/* ---------- Reminders & calendar ---------- */
const icsDate = (d: Date, allDay = false) => allDay
  ? d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0')
  : d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, c => '\\' + c);
export function toCalendar(n: Note, start: Date, { hasTime = true, alarm = false } = {}) {
  const end = new Date(+start + (hasTime ? 36e5 : DAY)), title = n.title || 'Note';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Notes//FR', 'BEGIN:VEVENT', 'UID:' + n.id + '-' + +start + '@notes',
    'DTSTAMP:' + icsDate(new Date()),
    hasTime ? 'DTSTART:' + icsDate(start) : 'DTSTART;VALUE=DATE:' + icsDate(start, true),
    hasTime ? 'DTEND:' + icsDate(end) : 'DTEND;VALUE=DATE:' + icsDate(end, true),
    'SUMMARY:' + icsText(title), 'DESCRIPTION:' + icsText(n.locked ? '' : n.body.slice(0, 1000)),
  ];
  if (alarm) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsText(title), 'TRIGGER:PT0M', 'END:VALARM');
  lines.push('END:VEVENT', 'END:VCALENDAR');
  download(new Blob([lines.join('\r\n')], { type: 'text/calendar' }), fileSafe(title) + '.ics');
}
export function setReminder(at: number) {
  if (!(at > Date.now())) return toast('Choisissez une date à venir.');
  const n = editNote({ remind: at, remindDone: false }, { save: 'now', touch: false });
  if (!n) return;
  closeLayer();
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  toast('Rappel le ' + eventDate(new Date(at), true) + '.', () => toCalendar(n, new Date(at), { alarm: true }), 'Agenda');
}
export function clearReminder() {
  editNote({ remind: null, remindDone: false }, { save: 'now', touch: false });
  closeLayer();
  toast('Rappel retiré.');
}
export function reminderToCalendar() {
  const n = openNote(get());
  if (n?.remind) toCalendar(n, new Date(n.remind), { alarm: true });
}
function notify(n: Note) {
  const title = n.locked ? 'Rappel' : n.title || 'Rappel', o = { body: n.locked ? 'Note masquée' : n.body.slice(0, 120), tag: 'note-' + n.id };
  if ('Notification' in window && Notification.permission === 'granted')
    (navigator.serviceWorker?.controller ? navigator.serviceWorker.ready.then(r => r.showNotification(title, o)) : Promise.resolve().then(() => new Notification(title, o)))
      .catch(() => {});
  toast('Rappel : ' + (n.locked ? 'note masquée' : n.title || 'Sans titre'), () => open(n.id), 'Ouvrir');
}
export const checkReminders = () =>
  updateNotes(get().notes.filter(n => !n.deleted && n.remind && !n.remindDone && n.remind <= Date.now()), { remindDone: true }).forEach(notify);

/* ---------- Sharing & merging ---------- */
const asText = (n: Note) => [n.title, n.body].filter(Boolean).join('\n\n');
export async function shareNotes(list: Note[]) {
  const text = list.map(asText).join('\n\n— — —\n\n'), title = list.length === 1 ? list[0].title || 'Note' : plural(list.length, 'note', 'notes');
  const files = list.flatMap(n => n.atts).filter(a => a.blob)
    .map((a, i) => new File([a.blob!], 'piece-jointe-' + (i + 1) + '.' + (a.blob!.type.split('/')[1] || 'bin').split(';')[0], { type: a.blob!.type }));
  const data: ShareData = { title, text };
  if (files.length && navigator.canShare?.({ files })) data.files = files;
  if (navigator.share)
    try { return await navigator.share(data); } catch (e) { if ((e as Error).name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text); toast(list.length > 1 ? 'Notes copiées.' : 'Note copiée.'); }
  catch { toast('Partage impossible sur cet appareil.'); }
}
const withUnlocked = (list: Note[], fn: () => void) => (list.every(n => !n.locked) || get().hiddenUnlocked ? fn() : unlock(fn));
export const shareOne = (n: Note) => withUnlocked([n], () => shareNotes([n]));

/* ---------- A note as a link: no server, the note travels compressed in the #fragment (never sent to any site) ---------- */
async function pack(data: object) {
  const zipped = new Uint8Array(await new Response(new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  let bin = '';
  zipped.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unpack(code: string) {
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(await new Response(new Blob([Uint8Array.from(bin, c => c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text());
}
export const shareLinkOne = (n: Note) => withUnlocked([n], async () => {
  const url = new URL('./', location.href);
  url.hash = 'n=' + (await pack({ t: n.title, b: n.body }));
  if (url.href.length > CONFIG.shareLinkMax) return toast('Note trop longue pour un lien : partagez-la en texte.', () => shareNotes([n]), 'Partager');
  const without = n.atts.length ? ' Les pièces jointes ne voyagent pas dans le lien.' : '';
  if (navigator.share)
    try { return await navigator.share({ title: n.title || 'Note', url: url.href }); } catch (e) { if ((e as Error).name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(url.href); toast('Lien copié.' + without); } catch { toast('Copie impossible sur cet appareil.'); }
});
async function receiveLink(code: string) {
  try {
    const d = await unpack(code);
    if (typeof d?.t !== 'string' || typeof d?.b !== 'string') throw Error('not a note');
    createAndOpen({ title: d.t.slice(0, 500), body: d.b.slice(0, 2e5) });
    const n = openNote(get());
    toast('Note reçue par lien.', () => { if (n) { closeEditor(); removeNotes(fresh([n])); } });
  } catch { toast('Ce lien de note est illisible ou incomplet.'); }
}

/* ---------- Every visible note as Markdown files in a .zip (an Obsidian-style vault: folders, attachments beside) ---------- */
export function exportVault() {
  const s = get(), list = s.notes.filter(n => !n.deleted && (!n.locked || s.hiddenUnlocked)), hidden = s.notes.some(n => !n.deleted && n.locked) && !s.hiddenUnlocked;
  if (!list.length) return toast('Aucune note à exporter.');
  toast('Préparation de l’archive…');
  const taken = new Set<string>(), unique = (path: string, ext: string) => {
    let p = path + ext;
    for (let i = 2; taken.has(p.toLowerCase()); i++) p = `${path} (${i})${ext}`;
    taken.add(p.toLowerCase());
    return p;
  };
  const iso = (t: number) => new Date(t).toISOString().slice(0, 19);
  const files = list.flatMap(n => {
    const dir = 'Notes/' + (n.folder ? fileSafe(n.folder) + '/' : ''), name = fileSafe(n.title || 'Sans titre').slice(0, 80);
    const atts = n.atts.filter(a => a.blob).map((a, i) => ({
      path: unique(dir + 'attachments/' + name + ' ' + (i + 1), '.' + ((a.name?.match(/\.(\w+)$/)?.[1]) || a.blob!.type.split('/')[1]?.split(';')[0] || 'bin')),
      data: a.blob!, date: n.updated,
    }));
    const md = ['---', 'created: ' + iso(n.created), 'updated: ' + iso(n.updated), ...(n.pinned ? ['pinned: true'] : []), '---', '',
      n.body.trimEnd(), ...atts.map(a => '\n![[' + a.path.slice(dir.length) + ']]')].join('\n') + '\n';
    return [{ path: unique(dir + name, '.md'), data: md, date: n.updated }, ...atts];
  });
  zip(files).then(blob => {
    download(blob, 'notes-' + new Date().toISOString().slice(0, 10) + '.zip');
    toast(plural(list.length, 'note exportée', 'notes exportées') + ' en Markdown' + (hidden ? ' (sans les notes masquées).' : '.'));
  }, () => toast('Échec de l’export.'));
}
export function shareSelection() {
  const l = selectedNotes();
  closeLayer();
  if (l.length) withUnlocked(l, () => shareNotes(l));
}
export function mergeSelection() {
  const picked = selectedNotes();
  if (picked.length < 2) return;
  closeLayer();
  withUnlocked(picked, () => {
    const order = tabNotes().filter(n => get().selection.has(n.id)), list = order.length ? order : picked, folders = new Set(list.map(n => n.folder));
    endSelecting();
    const merged = createNote({
      title: list[0].title || 'Notes fusionnées',
      body: list.map((n, i) => [i ? n.title : '', n.body].filter(Boolean).join('\n')).filter(Boolean).join('\n\n'),
      atts: list.flatMap(n => n.atts), folder: folders.size === 1 ? list[0].folder : '', locked: list.some(n => n.locked),
    });
    trashNotes(list);
    toast(plural(list.length, 'note fusionnée', 'notes fusionnées'), () => { removeNotes([merged]); untrashNotes(fresh(list)); });
  });
}

/* ---------- Study (spaced repetition) ---------- */
function setQueue(scope: number[], queue: ReturnType<typeof get>['study']['queue']) {
  set({ study: { scope, queue: shuffle(queue), index: 0, revealed: false, firstTry: 0, missed: new Set() } });
}
export function startStudy(notes: Note[], all = false) {
  setQueue(notes.map(n => n.id), notes.flatMap(n => (all ? flashcards(n.body) : dueCards(n)).map(card => ({ noteId: n.id, card }))));
  openSheet('study');
}
export const studyNotes = () => get().study.scope.map(noteById).filter((n): n is Note => !!n);
export const retryMissed = () => { const s = get().study; setQueue(s.scope, [...s.missed]); };
export function reveal() {
  const s = get().study;
  if (s.index < s.queue.length && !s.revealed) set({ study: { ...s, revealed: true } });
}
export function answer(knew: boolean) {
  const s = get().study, item = s.queue[s.index], n = item && noteById(item.noteId);
  if (!item || !s.revealed) return;
  if (n) updateNote(n, { cards: grade(n, item.card, knew) });
  const missed = new Set(s.missed), queue = s.queue.slice();
  if (!knew) { missed.add(item); queue.push(item); }
  set({ study: { ...s, queue, missed, index: s.index + 1, revealed: false, firstTry: s.firstTry + (knew && !s.missed.has(item) ? 1 : 0) } });
}
export function deleteCard() {
  const s = get().study, item = s.queue[s.index], n = item && noteById(item.noteId);
  if (!n) return;
  const body = removeCardLine(n.body, item.card);
  if (body === null) return toast('Cette carte a changé dans la note : supprimez-la depuis la note.');
  const cards = { ...n.cards };
  delete cards[item.card.key];
  updateNote(n, { body, cards }, { touch: true });
  const same = (x: typeof item) => x.noteId === item.noteId && x.card.key === item.card.key;
  set({ study: { ...s, queue: s.queue.filter((x, i) => i < s.index || !same(x)), missed: new Set([...s.missed].filter(x => !same(x))), revealed: false } });
  toast('Carte supprimée.', () => { const cur = noteById(n.id); if (cur) updateNote(cur, { body: n.body, cards: n.cards }); });
}
export function openMap(center: number | null = null) {
  set({ mapCenter: center });
  openSheet('map');
}

/* ---------- Exports & backup ---------- */
export function exportMarkdown() {
  const title = tabLabel(get().prefs.tab), list = tabNotes();
  const md = '# ' + title + '\n\n' + list.map(n => '## ' + (n.title || 'Sans titre') + '\n\n' + n.body.trim().replace(/^(#{1,3}) /gm, '##$1 ')
    + (n.atts.length ? '\n\n_' + plural(n.atts.length, 'pièce jointe', 'pièces jointes') + ' (non incluses dans ce fichier)_' : '')).join('\n\n') + '\n';
  download(new Blob([md], { type: 'text/markdown' }), fileSafe(title) + '.md');
  toast(plural(list.length, 'note exportée', 'notes exportées') + '.');
}
export function exportSlides() {
  const title = tabLabel(get().prefs.tab), list = tabNotes();
  toast('Préparation de la présentation…');
  exportPptx(title, list, fileSafe(title) + '.pptx').then(
    () => toast('Présentation exportée : ' + plural(list.length, 'diapositive', 'diapositives') + ' et une couverture.'),
    () => toast('Export impossible hors ligne la première fois : réessayez une fois connecté.'));
}
export function printTab() {
  set({ printing: tabNotes() });
  addEventListener('afterprint', () => set({ printing: null }), { once: true });
  setTimeout(() => print(), 100);
}
export function exportBackup() {
  closeLayer();
  const run = async () => {
    try {
      const s = get(), hidden = s.notes.filter(n => n.locked).length;
      download(await backupBlob(s.notes, s.folders, s.folderColors), 'notes-' + new Date().toISOString().slice(0, 10) + '.json');
      setPref('lastBackup', Date.now());
      persistStorage();
      // The JSON backup is in clear: hidden notes stay out of it (db.ts), and stay encrypted on the device
      toast(plural(s.notes.length - hidden, 'note exportée', 'notes exportées') + (hidden ? '. Les notes masquées n’y sont pas : elles restent chiffrées ici.' : '.'));
    } catch { toast('Échec de l’export.'); }
  };
  run();
}
export const backupDue = (s = get()) =>
  s.notes.filter(n => !n.deleted).length >= 3 && Date.now() - (s.prefs.lastBackup || s.prefs.firstRun || Date.now()) > CONFIG.backupNagDays * DAY;
/** Asks the browser to keep the notes (silent where granted on engagement). Called when the user shows they care: install, export. */
export function persistStorage() {
  navigator.storage?.persist?.().then(refreshStorage).catch(() => {});
}
export function install() {
  const p = get().install.prompt;
  if (!p) return;
  p.prompt();
  p.userChoice.finally(() => set(s => ({ install: { ...s.install, prompt: null } })));
}

/* ---------- Onboarding ---------- */
/** The guide lives in Aide, read in a sheet: it never sits among the user's notes. */
export const openGuide = () => openSheet('guide');
/** What's new in this version, any time (Réglages → Aide → Quoi de neuf). */
export const openNews = () => set({ newsSince: RELEASE_LIST[1]?.version || CURRENT.version, sheet: 'news' });
export function endWelcome(tour: boolean) {
  set({ welcome: false });
  setPref('onboarded', Date.now());
  if (tour) startTour();
}
export function startTour() {
  if (get().editor.id !== null) closeEditor();
  if (get().selecting) endSelecting();
  if (get().searchOpen) closeSearch();
  closeLayer();
  closeSheet();
  scrollTo(0, 0);
  set({ tour: 0 });
}
const tourHints = TOUR.flatMap(t => t.hints);
export function endTour() {
  set({ tour: null });
  setPref('hintsSeen', [...new Set([...(get().prefs.hintsSeen || []), ...tourHints])]);
}
export const tourStep = (i: number) => (i < TOUR.length ? set({ tour: Math.max(0, i) }) : endTour());
export const dismissHint = (id: string) => setPref('hintsSeen', [...(get().prefs.hintsSeen || []), id]);
export const currentHint = (prefs: Prefs, fine: boolean) =>
  HINTS.find(h => !(prefs.hintsSeen || []).includes(h.id) && (!h.fine || fine) && (!h.touch || !fine)) || null;

/* ---------- Boot ---------- */
export async function boot() {
  try {
    await openDb();
    const loaded: Partial<ReturnType<typeof get>> = {};
    for (const r of await getAll<{ id: string; data: unknown }>('prefs')) {
      if (r.id === 'P') loaded.prefs = { ...get().prefs, ...(r.data as Prefs) };
      else if (r.id === 'F' && Array.isArray(r.data)) loaded.folders = r.data;
      else if (r.id === 'FC' && r.data) loaded.folderColors = r.data as Record<string, number>;
      else if (r.id === 'PIN') loaded.pinHash = r.data as string;
      else if (r.id === 'VAULT') loaded.vault = r.data as Vault | null;
    }
    loaded.notes = (await getAll<Record<string, unknown>>('notes')).map(normalizeNote);
    set(loaded);
  } catch { set({ memOnly: true, folders: DEFAULT_FOLDERS.slice() }); }

  const prefs = get().prefs;
  if (!prefs.firstRun) setPref('firstRun', Date.now());
  syncLastId();
  // No sample notes: a first launch opens on an empty workspace that invites the first note (List.tsx, FirstUse)
  if (!prefs.onboarded) set({ welcome: true });
  const seen = prefs.seenVersion || (prefs.onboarded ? '2.1.0' : CURRENT.version);
  if (get().prefs.seenVersion !== CURRENT.version) setPref('seenVersion', CURRENT.version);
  if (releasesSince(seen).length && !get().welcome) set({ newsSince: seen, sheet: 'news' });
  removeNotes(get().notes.filter(n => n.deleted && n.deletedAt && n.deletedAt < Date.now() - CONFIG.trashDays * DAY));
  checkTab();
  set({ ready: true });
  if (get().memOnly) toast('Stockage indisponible : les notes seront perdues à la fermeture de la page.');
  get().notes.filter(n => n.atts.some(a => !a.blob)).forEach(n => updateNote(n, { atts: n.atts.map(attFromBackup).filter((a): a is NonNullable<typeof a> => !!a) }));
  handleLaunchUrl();
  addEventListener('hashchange', handleLaunchUrl);   // a note link opened while the app is already here
  checkReminders();
  setInterval(checkReminders, CONFIG.reminderPollMs);
}
/** ?new=…, shortcuts and share-target hand-offs. */
function handleLaunchUrl() {
  const link = location.hash.match(/^#n=([\w-]+)$/);
  if (link) { history.replaceState(null, '', location.pathname + location.search); return receiveLink(link[1]); }
  const q = new URLSearchParams(location.search), kind = q.get('new'), fields = { title: q.get('title') || '', text: q.get('text') || '', url: q.get('url') || '' };
  const files = q.has('share-files'), shared = fields.title || fields.text || fields.url;
  if (!kind && !files && !shared) return;
  history.replaceState(null, '', location.pathname);
  if (files) return sharedFiles(fields);
  if (shared) return importShared(fields);
  if (kind === 'list') fromTemplate('list'); else if (kind === 'today') dailyNote(); else if (kind === 'search') openSearch();
  else if (kind === 'voice') toggleRecording(); else createAndOpen();
}

/** The installed app's icon badge: cards to review plus reminders still due today (recomputed after a pause in typing). */
let badgeTimer = 0;
export function updateBadge(notes: Note[]) {
  const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  if (!nav.setAppBadge) return;
  clearTimeout(badgeTimer);
  badgeTimer = window.setTimeout(() => {
    const end = new Date().setHours(23, 59, 59, 999), live = notes.filter(n => !n.deleted);
    const count = live.reduce((t, n) => t + dueCards(n).length, 0) + live.filter(n => n.remind && !n.remindDone && n.remind <= end).length;
    (count ? nav.setAppBadge!(count) : nav.clearAppBadge?.() ?? Promise.resolve()).catch(() => {});
  }, 2000);
}

export const lastBackupLabel = (t?: number) => (t ? 'Dernière : ' + (isToday(t) ? 'aujourd’hui' : day(t)) : 'Jamais');
export const reminderLabel = (t: number) => dayTime(t);
