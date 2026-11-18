#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {
  DESTS, HERE, MAX_BYTES, REPO, evaluateWork, listWorks, loadSharp, manifestFrom, manifestText, srcPath,
} from './kit.mjs';

const sharp = await loadSharp();

const problems = [];
const fail = (m) => problems.push(m);
const rel = (p) => path.relative(REPO, p);

if (!fs.existsSync(path.join(HERE, 'LICENSE-NOTICE.md'))) fail('packages/brand/art/riso/LICENSE-NOTICE.md is missing (the kit is MIT: its notice must ship with adapted code)');
const works = listWorks();
const jobsByWork = [];
const paperOf = new Map();
for (const w of works) {
  if (!fs.existsSync(path.join(w.dir, 'PRINT.md'))) fail(`${rel(w.dir)}/PRINT.md is missing: every work records its design, inspection and weaknesses`);
  try {
    const { jobs, paper } = evaluateWork(w);
    jobsByWork.push(jobs);
    paperOf.set(w.name, [1, 3, 5].map((i) => parseInt(paper.slice(i, i + 2), 16)));
  } catch (e) { fail(`${rel(w.html)}: ${e.message}`); }
}

/**
 * Does the on-page file hold the paper file's inks, in register? Multiply it
 * onto the flat paper colour and compare with the paper file pixel by pixel.
 * The paper's mottling and both files' WebP error keep every pixel within 40
 * levels (measured: at most 0.03 % beyond it); the same file one pixel out of
 * register puts 3–19 % beyond it, another plate's inks more. The share of
 * pixels beyond 40 levels, as a fraction.
 */
async function onPageParity(paperFile, pageFile, paper) {
  const { data: p, info } = await sharp(paperFile).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const g = await sharp(pageFile).ensureAlpha().raw().toBuffer();
  let bad = 0;
  for (let i = 0, o = 0; i < p.length; i += 3, o += 4) {
    const a = g[o + 3] / 255;
    let d = 0;
    for (let c = 0; c < 3; c++) d += Math.abs(p[i + c] - paper[c] * (1 - a * (1 - g[o + c] / 255)));
    if (d > 120) bad++;
  }
  return bad / (info.width * info.height);
}

const workNames = works.map((w) => w.name).join('|');
const idRe = new RegExp(`['"\`]((?:${workNames || '\\u0000'})/[a-z0-9-]+/[a-z0-9-]+)['"\`]`, 'g');
const pathRe = /['"`(]\/art\/[^'"`)\s]*/g;
/** Source files that may name art ids; `skip` holds the generated manifests, which list them all. */
function* files(dir, skip) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { if (d.name !== 'node_modules') yield* files(p, skip); }
    else if (/\.(astro|ts|tsx|js|mjs|md|mdx|mdoc|yaml|json)$/.test(d.name) && !skip.has(p)) yield p;
  }
}
let totalIds = 0, totalFiles = 0;
for (const [dest, d] of Object.entries(DESTS)) {
  const { manifest: expected, missing } = manifestFrom(jobsByWork, dest);
  const declared = Object.keys(expected.art).length + missing.length > 0;
  if (!fs.existsSync(d.root)) { if (declared) fail(`${dest}: ${rel(d.root)} does not exist, but works export to it`); continue; }
  for (const m of missing) fail(`${rel(path.join(d.art, m.file))} is not exported: node packages/brand/art/riso/export.mjs --only ${m.id}`);
  const committed = fs.existsSync(d.manifest) ? fs.readFileSync(d.manifest, 'utf8') : '';
  if (!declared && !committed) {
    if (fs.existsSync(d.art) && fs.readdirSync(d.art).length) fail(`${rel(d.art)} holds files but no work exports to ${dest}`);
    continue;
  }
  if (committed !== manifestText(expected)) {
    fail(`${rel(d.manifest)} is stale against the JOBS tables or the files in ${rel(d.art)}/: node packages/brand/art/riso/export.mjs --manifest`);
  }
  let manifest = { art: {} };
  try { manifest = JSON.parse(committed); } catch { fail(`${rel(d.manifest)} is not JSON`); }

  const listed = new Set();
  for (const [id, e] of Object.entries(manifest.art || {})) {
    for (const l of ['de', 'en']) if (!e.alt || !String(e.alt[l] || '').trim()) fail(`${id}: alt text missing in ${l}`);
    if (e.caption) for (const l of ['de', 'en']) if (!String(e.caption[l] || '').trim()) fail(`${id}: caption missing in ${l}`);
    if (/TODO/.test(JSON.stringify([e.alt, e.caption]))) fail(`${id}: alt text or caption still says TODO`);
    for (const f of e.files || []) {
      if (!/\?v=[0-9a-f]{8}$/.test(f.src)) fail(`${id}: ${f.src} carries no ?v=<hash>; art is cached under stable names, so every URL must change with its bytes`);
      const file = path.join(d.root, 'public', srcPath(f.src));
      listed.add(path.basename(file));
      if (!fs.existsSync(file)) { fail(`${id}: ${rel(file)} does not exist`); continue; }
      const bytes = fs.statSync(file).size;
      if (bytes > MAX_BYTES) fail(`${id}: ${rel(file)} is ${(bytes / 1024).toFixed(0)} KB, over the 1 MB commit limit`);
      const m = await sharp(file).metadata();
      if (m.width !== f.width || m.height !== f.height) fail(`${id}: ${rel(file)} is ${m.width}x${m.height}, the manifest says ${f.width}x${f.height}`);
    }
    if (!e.page) continue;
    const twins = (e.files || []).map((f) => `${f.density}:${f.width}x${f.height}`).join(' ');
    if (e.page.map((f) => `${f.density}:${f.width}x${f.height}`).join(' ') !== twins) fail(`${id}: its on-page files are not at the paper files' densities and sizes (${twins})`);
    for (const f of e.page) {
      if (!/\?v=[0-9a-f]{8}$/.test(f.src)) fail(`${id}: ${f.src} carries no ?v=<hash>`);
      const file = path.join(d.root, 'public', srcPath(f.src));
      listed.add(path.basename(file));
      if (!fs.existsSync(file)) { fail(`${id}: ${rel(file)} does not exist`); continue; }
      const bytes = fs.statSync(file).size;
      if (bytes > MAX_BYTES) fail(`${id}: ${rel(file)} is ${(bytes / 1024).toFixed(0)} KB, over the 1 MB commit limit`);
      const m = await sharp(file).metadata();
      if (m.width !== f.width || m.height !== f.height) fail(`${id}: ${rel(file)} is ${m.width}x${m.height}, the manifest says ${f.width}x${f.height}`);
      if (!m.hasAlpha) { fail(`${id}: ${rel(file)} has no alpha; an on-page file is the inks alone`); continue; }
      const twin = e.files.find((p) => p.density === f.density);
      const paperFile = twin && path.join(d.root, 'public', srcPath(twin.src));
      if (!paperFile || !fs.existsSync(paperFile) || m.width !== f.width) continue;
      const off = await onPageParity(paperFile, file, paperOf.get(e.work) || [0xf4, 0xf2, 0xe8]);
      if (off > 0.005) fail(`${id}: ${rel(file)} multiplied onto the paper misses ${rel(paperFile)} in ${(off * 100).toFixed(1)} % of its pixels (out of register, or another bake): re-export both, node packages/brand/art/riso/export.mjs --only ${id}`);
    }
  }

  if (fs.existsSync(d.art)) {
    for (const f of fs.readdirSync(d.art)) {
      if (!listed.has(f)) fail(`${rel(path.join(d.art, f))} is in no manifest entry: delete it, or declare it in a work's JOBS`);
    }
  }

  const ids = new Set(Object.keys(manifest.art || {}));
  for (const file of d.srcs.flatMap((dir) => [...files(dir, new Set([d.manifest]))])) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(idRe)) if (!ids.has(m[1])) fail(`${rel(file)}: art id "${m[1]}" is not in the ${dest} manifest`);
    for (const m of text.matchAll(pathRe)) fail(`${rel(file)}: names the file ${m[0].slice(1)}; reference art by id`);
  }
  totalIds += ids.size; totalFiles += listed.size;
}

if (problems.length) {
  console.error(`riso check: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
console.log(`riso check: ${works.length} work(s), ${totalIds} art ids, ${totalFiles} files in ${Object.keys(DESTS).join(' + ')} ok`);
