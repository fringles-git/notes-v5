/** Attachments and files: object URLs, audio peaks, PDF text, OCR, imports (Markdown, HTML, EPUB) and PowerPoint export. */
import type { Attachment, AttType, Note } from './types';
import { CONFIG } from './config';
import { readDataUrl } from './db';
import { headingLevel, parseInline, parseLine } from './markdown';
import { day, loadScript } from './utils';

/* ---------- Object URLs, one per blob, released when no note uses the blob ---------- */
const urls = new Map<Blob, string>();
export function urlOf(a?: Attachment) {
  if (!a) return '';
  if (!a.blob) return a.url || '';
  let u = urls.get(a.blob);
  if (!u) urls.set(a.blob, (u = URL.createObjectURL(a.blob)));
  return u;
}
let gcTimer = 0;
export function releaseUrls(notes: Note[]) {
  clearTimeout(gcTimer);
  gcTimer = window.setTimeout(() => {
    const live = new Set<Blob>();
    notes.forEach(n => n.atts.forEach(a => a.blob && live.add(a.blob)));
    urls.forEach((u, b) => { if (!live.has(b)) { URL.revokeObjectURL(u); urls.delete(b); } });
  }, 1000);
}

export function fileToAtt(f: File): Attachment | null {
  const t = f.type, type: AttType | null = t.startsWith('audio') ? 'audio' : t.startsWith('image') ? 'image' : t === 'application/pdf' ? 'pdf' : null;
  return type && { type, blob: new Blob([f], { type: f.type }), size: f.size, name: f.name };
}
export const isHeavy = (files: { size: number }[]) => files.some(f => f.size > CONFIG.attWarnBytes);
export const firstAtt = (n: Note, type: AttType) => n.atts.find(a => a.type === type);

/** A readable title from a file name, or "Photo du …" for camera names like IMG_1234. */
export function titleFromFile(name: string, type: AttType) {
  const base = name.replace(/\.[^.]+$/, '').trim();
  const meaningless = !/[a-zà-ÿ]{3,}/i.test(base.replace(/^(IMG|PXL|DSC|DCIM|VID|MVIMG|Screenshot|Capture|image|photo|audio|recording|enregistrement)/i, ''))
    || /^[0-9a-f_-]{12,}$/i.test(base);
  return meaningless ? (type === 'audio' ? 'Audio du ' : 'Photo du ') + day(Date.now()) : base;
}

/* ---------- Analysis ---------- */
export async function audioPeaks(blob: Blob) {
  const w = window as unknown as { OfflineAudioContext: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext };
  const Ctx = w.OfflineAudioContext || w.webkitOfflineAudioContext!, ctx = new Ctx(1, 1, 44100), data = await blob.arrayBuffer();
  const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject);
    p?.then?.(resolve, reject);
  });
  const ch = buffer.getChannelData(0), n = CONFIG.wavePeaks, step = Math.max(1, Math.floor(ch.length / n)), peaks: number[] = [];
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let j = i * step, end = Math.min(ch.length, j + step); j < end; j += 16) m = Math.max(m, Math.abs(ch[j]));
    peaks.push(m);
  }
  const max = Math.max(...peaks) || 1;
  return { peaks: peaks.map(p => Math.round((p / max) * 100) / 100), duration: buffer.duration };
}

interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(o: { data: ArrayBuffer }): { promise: Promise<{ numPages: number; getPage(i: number): Promise<{ getTextContent(): Promise<{ items: { str: string }[] }> }> }> };
}
export async function pdfText(blob: Blob) {
  const lib = await loadScript<PdfJs>('./vendor/pdf.min.js', 'pdfjsLib');
  lib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
  const doc = await lib.getDocument({ data: await blob.arrayBuffer() }).promise;
  let text = '';
  for (let i = 1; i <= Math.min(doc.numPages, 60); i++)
    text += (await (await doc.getPage(i)).getTextContent()).items.map(it => it.str).join(' ') + '\n';
  return { text: text.replace(/[ \t]+/g, ' ').slice(0, 2e5), pages: doc.numPages };
}

const extras = () => new URL('vendor/extra/', location.href).href;
type OcrWorker = { recognize(b: Blob): Promise<{ data: { text: string } }> };
let ocrWorker: Promise<OcrWorker> | null = null, ocrQueue: Promise<unknown> = Promise.resolve();
async function shrink(blob: Blob) {
  const bmp = await createImageBitmap(blob), k = Math.min(1, CONFIG.ocrMaxSide / Math.max(bmp.width, bmp.height));
  if (k === 1) return blob;
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
}
/** Reads the text of a photo on the device; jobs run one at a time. */
export function ocrText(blob: Blob) {
  const job = ocrQueue.then(async () => {
    ocrWorker ||= loadScript<{ createWorker(l: string, o: number, p: object): Promise<OcrWorker> }>('./vendor/extra/tesseract.min.js', 'Tesseract')
      .then(T => T.createWorker('fra', 1, { workerPath: extras() + 'worker.min.js', corePath: extras(), langPath: extras().slice(0, -1) }))
      .catch(e => { ocrWorker = null; throw e; });
    const { data } = await (await ocrWorker).recognize(await shrink(blob));
    return data.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 2e5);
  });
  ocrQueue = job.catch(() => {});
  return job;
}

/* ---------- Speech to text on the device (public/vendor/extra/asr/worker.js) ---------- */
/** The recording as 16 kHz mono samples, what Whisper reads. */
async function pcm16k(blob: Blob) {
  const w = window as unknown as { OfflineAudioContext: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext };
  const Ctx = w.OfflineAudioContext || w.webkitOfflineAudioContext!, data = await blob.arrayBuffer();
  const buf = await new Promise<AudioBuffer>((resolve, reject) => {
    const p = new Ctx(1, 1, 16000).decodeAudioData(data, resolve, reject);
    p?.then?.(resolve, reject);
  });
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) buf.getChannelData(c).forEach((v, i) => { out[i] += v / buf.numberOfChannels; });
  return out;
}
let asrWorker: Worker | null = null, asrSeq = 0, asrProgress: ((loaded: number, total: number) => void) | undefined;
const asrJobs = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
/** Transcribes a recording; `onLoading` hears the model download (first use only). */
export async function transcribe(blob: Blob, onLoading?: (loaded: number, total: number) => void) {
  const audio = await pcm16k(blob);
  if (!asrWorker) {
    asrWorker = new Worker(new URL('vendor/extra/asr/worker.js', location.href), { type: 'module' });
    asrWorker.onmessage = ({ data }) => {
      if (data.progress) return asrProgress?.(data.progress.loaded, data.progress.total);
      const job = asrJobs.get(data.id);
      asrJobs.delete(data.id);
      if (data.error) job?.reject(Error(data.error)); else job?.resolve(data.text);
    };
  }
  asrProgress = onLoading || asrProgress;
  const id = ++asrSeq;
  return new Promise<string>((resolve, reject) => {
    asrJobs.set(id, { resolve, reject });
    asrWorker!.postMessage({ id, audio }, [audio.buffer]);
  });
}

/* ---------- Imports ---------- */
export function splitTitle(md: string, fallback: string) {
  const h = md.match(/^\s*# +(.+)\n?/), body = (h ? md.slice(h[0].length) : md).replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n').trimEnd();
  return { title: h ? h[1].trim() : fallback, body };
}

export const markdownToNote = (name: string, text: string) => splitTitle(
  text.replace(/\r\n?/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/!\[\[[^\]\n]*\]\]|!\[[^\]\n]*\]\([^)\n]*\)/g, '')
    .replace(/\[\[([^\]|\n]+)\|[^\]\n]+\]\]/g, '[[$1]]')
    .replace(/\[([^\]\n]+)\]\((https?:[^)\s]+)\)/g, '$1 $2')
    .replace(/^#{4,6} /gm, '### ')
    .replace(/^[ \t]+(?=[-*+] |\d+[.)] )/gm, '')
    .replace(/^[*+] /gm, '- ')
    .replace(/__([^_\n]+)__/g, '**$1**'),
  name.replace(/\.[^.]+$/, ''));

const SKIP = new Set(['script', 'style', 'img', 'svg', 'figure', 'nav', 'head', 'title']);
const BLOCK = new Set(['body', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'blockquote', 'ul', 'ol', 'table', 'tbody', 'thead', 'tr', 'td', 'th']);
function inlineText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/\s+/g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const tag = (node as Element).localName;
  if (SKIP.has(tag)) return '';
  if (tag === 'br') return '\n';
  const t = [...node.childNodes].map(inlineText).join(''), core = t.trim();
  if (!core) return t;
  return tag === 'strong' || tag === 'b' ? t.replace(core, '**' + core + '**') : tag === 'em' || tag === 'i' ? t.replace(core, '*' + core + '*') : t;
}
function htmlToNote(doc: Document, fallback: string) {
  const out: string[] = [];
  if (doc.body)
    (function walk(el: Element, lines: string[]) {
      let para = '', n = 0;
      const flush = () => { if (para.trim()) lines.push(para.trim(), ''); para = ''; };
      for (const c of el.childNodes) {
        const tag = c.nodeType === Node.ELEMENT_NODE ? (c as Element).localName : '';
        if (SKIP.has(tag)) continue;
        if (/^h[1-6]$/.test(tag)) { flush(); lines.push('#'.repeat(Math.min(+tag[1], 3)) + ' ' + inlineText(c).trim(), ''); }
        else if (tag === 'p' || tag === 'pre') { flush(); para = inlineText(c); flush(); }
        else if (tag === 'li') { flush(); lines.push((el.localName === 'ol' ? ++n + '. ' : '- ') + inlineText(c).trim()); }
        else if (BLOCK.has(tag)) { flush(); walk(c as Element, lines); if (tag === 'ul' || tag === 'ol') lines.push(''); }
        else para += inlineText(c);
      }
      flush();
    })(doc.body, out);
  return splitTitle(out.join('\n').replace(/^#{2,3} /, '# '), doc.title?.trim() || fallback);
}
export const htmlFileToNote = (name: string, html: string) =>
  htmlToNote(new DOMParser().parseFromString(html, 'text/html'), name.replace(/\.[^.]+$/, ''));

/** Minimal ZIP reader (stored + deflate) for EPUB. */
async function unzip(file: Blob) {
  const v = new DataView(await file.arrayBuffer()), entries = new Map<string, () => Promise<string>>();
  let end = v.byteLength - 22;
  while (end >= 0 && v.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw Error('not a zip');
  let p = v.getUint32(end + 16, true);
  for (let count = v.getUint16(end + 10, true); count > 0; count--) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true), nameLen = v.getUint16(p + 28, true);
    const skip = nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(v.buffer, p + 46, nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true), part = file.slice(start, start + size);
    entries.set(name, () => (method === 8 ? new Response(part.stream().pipeThrough(new DecompressionStream('deflate-raw'))).text() : part.text()));
    p += 46 + skip;
  }
  return entries;
}
/** Minimal ZIP writer, stored (photos and audio are already compressed; Markdown is small). UTF-8 names. */
const CRC = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = (b: Uint8Array) => { let c = ~0; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
export async function zip(files: { path: string; data: Blob | string; date: number }[]) {
  const enc = new TextEncoder(), parts: BlobPart[] = [], central: BlobPart[] = [];
  let offset = 0, centralSize = 0;
  for (const f of files) {
    const data = typeof f.data === 'string' ? enc.encode(f.data) : new Uint8Array(await f.data.arrayBuffer()), name = enc.encode(f.path), d = new Date(f.date);
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const head = (sig: number, size: number, at: number) => {
      const v = new DataView(new ArrayBuffer(size));
      v.setUint32(0, sig, true);
      const o = at;   // central headers carry "version made by" first, then the same fields as local ones
      v.setUint16(o, 20, true); v.setUint16(o + 2, 0x0800, true); v.setUint16(o + 6, time, true); v.setUint16(o + 8, date, true);
      v.setUint32(o + 10, crc, true); v.setUint32(o + 14, data.length, true); v.setUint32(o + 18, data.length, true); v.setUint16(o + 22, name.length, true);
      return v;
    };
    const crc = crc32(data), local = head(0x04034b50, 30, 4), entry = head(0x02014b50, 46, 6);
    entry.setUint16(4, 20, true);
    entry.setUint32(42, offset, true);
    parts.push(local.buffer, name, data);
    central.push(entry.buffer, name);
    offset += 30 + name.length + data.length;
    centralSize += 46 + name.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

export async function epubToNotes(file: File) {
  const zip = await unzip(file), xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
  const read = (path: string) => zip.get(path)?.() ?? Promise.reject(Error('missing ' + path));
  const opfPath = xml(await read('META-INF/container.xml')).querySelector('rootfile')?.getAttribute('full-path') || '';
  const opf = xml(await read(opfPath)), dir = opfPath.slice(0, opfPath.lastIndexOf('/') + 1);
  const title = opf.querySelector('metadata > title, title')?.textContent?.trim() || file.name.replace(/\.[^.]+$/, '');
  const hrefs = new Map([...opf.querySelectorAll('manifest > item')].map(i => [i.getAttribute('id'), i.getAttribute('href')]));
  const chapters: { title: string; body: string }[] = [];
  for (const ref of opf.querySelectorAll('spine > itemref')) {
    const href = hrefs.get(ref.getAttribute('idref'));
    if (!href) continue;
    const ch = htmlToNote(new DOMParser().parseFromString(await read(decodeURIComponent(dir + href)), 'text/html'), title + ' — ' + (chapters.length + 1));
    if (ch.body.length > 40) chapters.push(ch);
  }
  return { title, chapters };
}

/* ---------- PowerPoint export ---------- */
const INK = '1C1C1E', MUTED = '636366', ACCENT = 'F4C542', FONT = 'Arial';
type Run = { text: string; options: Record<string, unknown> };
function bodyRuns(body: string): Run[] {
  const lines = body.split('\n').filter((l, i, a) => l.trim() || (i > 0 && a[i - 1].trim())), shown = lines.slice(0, 16);
  const runs = shown.flatMap(line => {
    const p = parseLine(line), h = headingLevel(p.kind);
    const base = { bullet: p.kind === 'bullet' || (p.kind === 'number' && { type: 'number' }), bold: h > 0, fontSize: h ? 24 - 2 * h : 16 };
    const out: Run[] = (p.kind === 'check' ? [{ text: /x/i.test(p.prefix) ? '☑ ' : '☐ ', options: { ...base } }] : []).concat(
      parseInline(p.text).leaves.map(l => ({
        text: l.text,
        options: { ...base, bold: base.bold || l.marks.includes('b'), italic: l.marks.includes('i'), highlight: l.marks.includes('hl') ? 'FBE7A1' : undefined },
      })));
    if (!out.length) out.push({ text: ' ', options: { ...base } });
    out[out.length - 1].options.breakLine = true;
    return out;
  });
  if (lines.length > shown.length) runs.push({ text: '…', options: { color: MUTED } });
  else delete runs[runs.length - 1].options.breakLine;
  return runs;
}
async function slideImage(n: Note) {
  const blob = firstAtt(n, 'image')?.blob;
  if (!blob) return null;
  const { width, height } = await createImageBitmap(blob), k = Math.min(4.8 / width, 5.9 / height), w = width * k, h = height * k;
  return { data: await readDataUrl(blob), x: 7.8 + (4.8 - w) / 2, y: 0.8 + (5.9 - h) / 2, w, h };
}
export async function exportPptx(title: string, notes: Note[], fileName: string) {
  const Pptx = await loadScript<any>('./vendor/extra/pptxgen.bundle.js', 'PptxGenJS'), deck = new Pptx();
  deck.layout = 'LAYOUT_WIDE';
  deck.title = title;
  const bar = (s: { addShape: (t: string, o: object) => void }, y: number, w: number, h: number) =>
    s.addShape('rect', { x: 0.8, y, w, h, fill: { color: ACCENT }, line: { color: ACCENT } });
  const cover = deck.addSlide();
  cover.background = { color: 'F2F2F7' };
  bar(cover, 2.6, 0.9, 0.12);
  cover.addText(title, { x: 0.8, y: 2.8, w: 11.7, h: 1.2, fontFace: FONT, fontSize: 44, bold: true, color: INK });
  cover.addText(`${notes.length} note${notes.length > 1 ? 's' : ''} · ${day(Date.now())} ${new Date().getFullYear()}`,
    { x: 0.8, y: 4, w: 11.7, h: 0.6, fontFace: FONT, fontSize: 18, color: MUTED });
  for (const n of notes) {
    const s = deck.addSlide(), img = await slideImage(n).catch(() => null), w = img ? 6.6 : 11.7;
    s.background = { color: 'FFFFFF' };
    bar(s, 0.55, 0.6, 0.08);
    s.addText(n.title || 'Sans titre', { x: 0.8, y: 0.7, w, h: 0.9, fontFace: FONT, fontSize: 30, bold: true, color: INK, fit: 'shrink' });
    s.addText([n.folder, day(n.updated)].filter(Boolean).join(' · '), { x: 0.8, y: 1.55, w, h: 0.4, fontFace: FONT, fontSize: 12, color: MUTED });
    if (n.body.trim())
      s.addText(bodyRuns(n.body), { x: 0.8, y: 2.1, w, h: 4.9, fontFace: FONT, color: INK, valign: 'top', paraSpaceAfter: 4, fit: 'shrink' });
    if (img) s.addImage(img);
  }
  await deck.writeFile({ fileName });
}
