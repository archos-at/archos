#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { args, evaluateWork, kitEnv, requireKit, selectWorks } from './kit.mjs';

const a = args(process.argv.slice(2));
const kit = requireKit();
if (kit.engines && kit.engines.length < 2) {
  console.warn(`WARNING: only ${kit.engines.join(', ')} launches here; the kit's verify runs both engines and will fail on the other.`);
}
let failed = 0;
for (const w of selectWorks(a.work)) {
  const { jobs } = evaluateWork(w);
  const times = a.times && a.times !== true ? String(a.times) : jobs.map((_, i) => i).join(',');
  console.log(`\n── ${w.name}: ${times.split(',').length} of ${jobs.length} jobs ──`);
  const r = spawnSync(process.execPath, ['verify.mjs', w.html, '--times', times], { cwd: kit.tools, env: kitEnv(kit), stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.error(`${w.name}: determinism check FAILED (${path.relative(process.cwd(), w.html)})`); }
}
process.exit(failed ? 1 : 0);
