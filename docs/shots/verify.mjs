// Design verification for notes-v5: 12 home shots (390/768/1280 × paper/glass × light/dark), Réglages per look,
// automated contrast (text ≥4.5:1, muted ≥7:1), reduced-motion and high-contrast checks. Results → JSON + PNG.
// Usage, without adding a dependency to package.json:
//   bun add --no-save playwright-core@1.64.1 && npx playwright-core install chromium   (once)
//   npx vite dev --host 127.0.0.1 --port 5173 &  node docs/shots/verify.mjs http://127.0.0.1:5173/ /tmp/shots [--quick]
// CHROMIUM_PATH=/path/to/chrome uses another Chromium. The committed docs/shots/*.jpg are these PNGs at JPEG q80.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const [, , URL = 'http://127.0.0.1:5173/', OUT = './shots'] = process.argv;
const QUICK = process.argv.includes('--quick');
fs.mkdirSync(OUT, { recursive: true });
const DAY = 864e5, T0 = Date.parse('2026-10-19T10:00:00+02:00');
const NOTES = [
  { id: T0, title: 'Courses du week-end', body: '- [x] Pain\n- [x] Café\n- [ ] Tomates\n- [ ] Basilic\n- [ ] Parmesan', folder: 'Maison', pinned: true },
  { id: T0 - DAY, title: 'Réunion produit', body: '## Décisions\n- Lancer la bêta le **3 novembre**\n- Revoir le tunnel d’inscription\n\n#produit #équipe', folder: 'Travail' },
  { id: T0 - 2 * DAY, title: 'Idées pour le salon', body: 'Une étagère basse en chêne sous la fenêtre, des plantes grimpantes, une lampe à poser chaude. Repeindre le mur du fond en vert sauge.', folder: 'Maison' },
  { id: T0 - 3 * DAY, title: 'Lire', body: 'Le Mythe de Sisyphe\nLes Années — Annie Ernaux\nL’Art de la joie', folder: '' },
  { id: T0 - 5 * DAY, title: 'Plan du trimestre', body: '1. Recruter deux développeurs\n2. Sortir la version mobile\n3. Réduire le temps de chargement de 30 %', folder: 'Travail' },
  { id: T0 - 8 * DAY, title: 'Recette — pâtes au citron', body: 'Zeste et jus d’un citron, beurre, parmesan, poivre. L’eau des pâtes fait la sauce.', folder: '' },
];
const seed = ({ notes, prefs }) => {
  const req = indexedDB.open('NotesAppDB', 1);
  req.onupgradeneeded = () => {
    ['notes', 'prefs'].forEach(s => req.result.createObjectStore(s, { keyPath: 'id' }));
    const t = req.transaction, n = t.objectStore('notes'), p = t.objectStore('prefs');
    notes.forEach(x => n.put({ by: 'me', pinned: false, locked: false, atts: [], versions: [], created: x.id, updated: x.id, ...x }));
    p.put({ id: 'P', data: prefs });
    p.put({ id: 'F', data: ['Travail', 'Maison'] });
    p.put({ id: 'FC', data: { Travail: 1, Maison: 3 } });
  };
  req.onsuccess = () => req.result.close();
};
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });

async function open({ look, scheme, width, height, contrast = 'no-preference', reducedMotion = 'reduce' }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, reducedMotion, contrast, locale: 'fr-FR', timezoneId: 'Europe/Paris', hasTouch: width < 700, deviceScaleFactor: 1 });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date(T0 + 3600e3));
  await page.addInitScript(seed, { notes: NOTES, prefs: { onboarded: 1, look, theme: 'auto', seenVersion: '99.0.0', hintsSeen: ['paste', 'pull', 'swipe', 'select', 'search', 'keys', 'long'] } });
  await page.addInitScript(l => { try { localStorage.setItem('notes:look', l); } catch {} }, look);
  await page.goto(URL);
  await page.waitForSelector('#note-list .card', { timeout: 30000 });
  if (await page.locator('.sheet').count()) { await page.keyboard.press('Escape'); await page.waitForSelector('.sheet', { state: 'detached' }).catch(() => {}); }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  return { ctx, page, errors };
}

/** Contrast of every visible text node against the solid colour it actually sits on (translucent layers composited). */
const audit = () => {
  const cv = document.createElement('canvas').getContext('2d');
  const pe = document.createElement('i'); document.body.append(pe);
  const rgba = c => {   // any computed colour (rgb, color(srgb), oklab, lab…) → [r, g, b, a] in 0–255
    if (/^rgba?\(/.test(c)) { const m = c.match(/[\d.]+/g).map(Number); return [m[0], m[1], m[2], m[3] ?? 1]; }
    pe.style.color = `color-mix(in srgb, ${c} 100%, transparent)`;
    const v = getComputedStyle(pe).color, m = v.match(/-?[\d.]+(e-?\d+)?/g).map(Number);
    if (v.startsWith('color(')) return [m[0] * 255, m[1] * 255, m[2] * 255, m[3] ?? 1];
    return [m[0], m[1], m[2], m[3] ?? 1];
  };
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map(i => top[i] * a + under[i] * (1 - a)).concat(1); };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
  const probe = v => { const e = document.createElement('i'); e.style.color = `var(${v})`; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return rgba(c).join(); };
  const MUTED = probe('--color-text-muted'), FAINT = probe('--color-text-faint');
  const ground = rgba(getComputedStyle(document.documentElement).backgroundColor);
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    const el = n.parentElement, text = n.textContent.trim();
    if (!text || !el || el.closest('[aria-hidden="true"], [inert], .visually-hidden, script, style, svg')) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (!r.width || !r.height || cs.visibility !== 'visible' || r.bottom < 0 || r.top > innerHeight) continue;
    let dim = false, img = false, chain = [];
    for (let a = el; a; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (+s.opacity < 1) dim = true;
      if (a.matches('button:disabled, [aria-disabled="true"]')) dim = true;
      if (s.backgroundImage.includes('url(') || a.querySelector(':scope > img')) img = true;
      const bg = rgba(s.backgroundColor); if (bg[3] > 0) chain.push(bg);
    }
    if (dim || img) continue;
    let base = ground; for (const bg of chain.reverse()) base = over(bg, base);
    const fg = over(rgba(cs.color), base), c = rgba(cs.color).join();
    const role = c === MUTED ? 'muted' : c === FAINT ? 'faint' : 'text';
    const need = role === 'muted' ? 7 : 4.5, got = ratio(fg, base);
    out.push({ role, need, got: Math.round(got * 100) / 100, ok: got >= need - .005, text: text.slice(0, 40), cls: (el.className?.baseVal ?? el.className) || el.tagName.toLowerCase() });
  }
  return out;
};

const results = { shots: [], contrast: [], motion: [], hc: [], errors: [] };
const LOOKS = ['glass', 'paper'], SCHEMES = ['light', 'dark'], SIZES = QUICK ? [[390, 844]] : [[390, 844], [768, 1024], [1280, 800]];
for (const look of LOOKS) for (const scheme of SCHEMES) {
  for (const [width, height] of SIZES) {
    const { ctx, page, errors } = await open({ look, scheme, width, height });
    const file = `home-${look}-${scheme}-${width}.png`;
    await page.screenshot({ path: `${OUT}/${file}`, animations: 'disabled', caret: 'hide' });
    results.shots.push(file);
    const c = await page.evaluate(audit); results.contrast.push({ look, scheme, width, screen: 'home', fails: c.filter(x => !x.ok), checked: c.length, min: Object.fromEntries(['text', 'muted', 'faint'].map(r => [r, Math.min(...c.filter(x => x.role === r).map(x => x.got))])) });
    if (width === 390) {
      await page.click('#nav-settings');
      await page.waitForSelector('.sheet[data-mode="settings"]');
      await page.waitForTimeout(450);
      const f2 = `settings-${look}-${scheme}-${width}.png`;
      await page.screenshot({ path: `${OUT}/${f2}`, animations: 'disabled', caret: 'hide' });
      results.shots.push(f2);
      const s = await page.evaluate(audit); results.contrast.push({ look, scheme, width, screen: 'settings', fails: s.filter(x => !x.ok), checked: s.length, min: Object.fromEntries(['text', 'muted', 'faint'].map(r => [r, Math.min(...s.filter(x => x.role === r).map(x => x.got))])) });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.click('.card .card-open');
      await page.waitForSelector('.editor.open');
      await page.waitForTimeout(500);
      const f3 = `editor-${look}-${scheme}-${width}.png`;
      await page.screenshot({ path: `${OUT}/${f3}`, animations: 'disabled', caret: 'hide' });
      results.shots.push(f3);
      const e = await page.evaluate(audit); results.contrast.push({ look, scheme, width, screen: 'editor', fails: e.filter(x => !x.ok), checked: e.length, min: Object.fromEntries(['text', 'muted', 'faint'].map(r => [r, Math.min(...e.filter(x => x.role === r).map(x => x.got))])) });
    }
    if (errors.length) results.errors.push({ look, scheme, width, errors });
    await ctx.close();
  }
  // Reduced motion: durations collapse, press scale off. High contrast: muted darkens, lines thicken, glass turns solid.
  {
    const { ctx, page } = await open({ look, scheme, width: 390, height: 844, reducedMotion: 'reduce' });
    results.motion.push({ look, scheme, ...(await page.evaluate(() => { const s = getComputedStyle(document.documentElement); return { fast: s.getPropertyValue('--fast').trim(), slow: s.getPropertyValue('--slow').trim(), press: s.getPropertyValue('--press').trim(), ambientAnim: getComputedStyle(document.querySelector('.card')).animationDuration }; })) });
    await ctx.close();
  }
  {
    const { ctx, page } = await open({ look, scheme, width: 390, height: 844, contrast: 'more' });
    const file = `contrast-more-${look}-${scheme}-390.png`;
    await page.screenshot({ path: `${OUT}/${file}`, animations: 'disabled' });
    results.shots.push(file);
    const c = await page.evaluate(audit);
    results.hc.push({ look, scheme, dockBlur: await page.evaluate(() => getComputedStyle(document.querySelector('#nav-island')).backdropFilter), cardBorder: await page.evaluate(() => getComputedStyle(document.querySelector('.card')).borderTopWidth), fails: c.filter(x => !x.ok), min: Object.fromEntries(['text', 'muted', 'faint'].map(r => [r, Math.min(...c.filter(x => x.role === r).map(x => x.got))])) });
    await ctx.close();
  }
}
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
await browser.close();
const fails = results.contrast.flatMap(r => r.fails.map(f => `${r.look}/${r.scheme}/${r.width}/${r.screen}: ${f.role} ${f.got} < ${f.need} "${f.text}" .${f.cls}`)).concat(results.hc.flatMap(r => r.fails.map(f => `HC ${r.look}/${r.scheme}: ${f.role} ${f.got} < ${f.need} "${f.text}" .${f.cls}`)));
console.log(`shots ${results.shots.length}, contrast checks ${results.contrast.reduce((t, r) => t + r.checked, 0)}, failures ${fails.length}, page errors ${results.errors.length}`);
for (const r of results.contrast) console.log(`${r.look.padEnd(5)} ${r.scheme.padEnd(5)} ${String(r.width).padEnd(4)} ${r.screen.padEnd(8)} min text ${r.min.text} muted ${r.min.muted} faint ${r.min.faint}`);
console.log([...new Set(fails)].slice(0, 40).join('\n'));
if (results.errors.length) console.log(JSON.stringify(results.errors).slice(0, 800));
