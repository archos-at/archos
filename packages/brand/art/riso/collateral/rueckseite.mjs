#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import sharp from 'sharp';
import { OUT, WEB, kitBrowser, requireKit } from '../kit.mjs';

const DIR = path.join(OUT, 'collateral');
const STEM = 'piloti-karte-rueckseite-a6-1240x1748';
const FRONT = path.join(DIR, 'piloti-kaffee-a6-1240x1748.png');
const BACK = path.join(DIR, `${STEM}.png`);
const SEP = path.join(DIR, `${STEM}-sep-1-hunter.png`);
for (const f of [FRONT, BACK, SEP]) {
  if (!fs.existsSync(f)) { console.error(`${path.relative(WEB, f)} missing: node art/riso/export.mjs --work collateral`); process.exit(1); }
}

const HUNTER = '#407060';
const font = (f) => url.pathToFileURL(path.join(WEB, 'public', 'fonts', f)).href;
const href = (f) => url.pathToFileURL(f).href;

const TEXT = `
  <div class="t danke" style="left:calc(9*var(--mm));top:calc(8*var(--mm))">Danke.</div>
  <div class="t names" style="left:calc(9*var(--mm));top:calc(88.5*var(--mm))">Jonathan Uhlemann<br>Matthias Bigl<br>Ferdinand Rubenbauer<br><br>Piloti · Wien<br>piloti.at</div>`;

const page = (mm, bg, colour, blend) => `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: 'Instrument Serif'; src: url('${font('instrument-serif-400-latin.woff2')}'); }
  @font-face { font-family: 'IBM Plex Mono'; font-weight: 500; src: url('${font('ibm-plex-mono-500-latin.woff2')}'); }
  :root { --mm: ${mm}; }
  html, body { margin: 0; }
  .card { position: relative; width: calc(105*var(--mm)); height: calc(148*var(--mm)); overflow: hidden; break-after: page; }
  .card img { position: absolute; inset: 0; width: 100%; height: 100%; }
  .t { position: absolute; color: ${colour}; mix-blend-mode: ${blend}; }
  .danke { font: 400 calc(11*var(--mm))/1 'Instrument Serif', serif; letter-spacing: -0.01em; }
  .names { font: 500 calc(2.55*var(--mm))/1.45 'IBM Plex Mono', monospace; letter-spacing: 0.02em; }
</style>${bg}`;

const TMP = path.join(DIR, '.rueckseite.html');
const open = async (p, html) => { fs.writeFileSync(TMP, html); await p.goto(href(TMP), { waitUntil: 'load' }); await p.evaluate(() => document.fonts.ready); };

const kit = requireKit();
const { launch } = await kitBrowser(kit);
const browser = await launch('chromium');
try {
  const png = async (img, colour, blend, out, gray) => {
    const p = await browser.newPage({ viewport: { width: 1240, height: 1748 }, deviceScaleFactor: 1 });
    await open(p, page(`${1240 / 105}px`, `<div class="card"><img src="${href(img)}">${TEXT}</div>`, colour, blend));
    let buf = await p.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1240, height: 1748 } });
    await p.close();
    let s = sharp(buf).withMetadata({ density: 300 });
    if (gray) s = s.toColourspace('b-w');
    await s.png({ compressionLevel: 9 }).toFile(out);
    console.log(`  ${path.relative(WEB, out)}`);
  };
  await png(BACK, HUNTER, 'multiply', path.join(DIR, 'piloti-karte-rueckseite-text-a6-1240x1748.png'));
  await png(SEP, '#000', 'normal', path.join(DIR, 'piloti-karte-rueckseite-text-a6-1240x1748-sep-1-hunter.png'), true);

  const p = await browser.newPage();
  await open(p, page('1mm', `<div class="card"><img src="${href(FRONT)}"></div><div class="card"><img src="${href(BACK)}">${TEXT}</div>`, HUNTER, 'multiply'));
  const pdf = path.join(DIR, 'piloti-karte-a6-proof.pdf');
  await p.pdf({ path: pdf, width: '105mm', height: '148mm', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  console.log(`  ${path.relative(WEB, pdf)}`);
} finally {
  await browser.close();
  fs.rmSync(TMP, { force: true });
}
