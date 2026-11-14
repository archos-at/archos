/**
 * The promotion's carry of reviewed knowledge releases (ADR-0181): `bff/base-knowledge/platform/carry.ts` over
 * the bundles in `config/knowledge-releases/` (the manifest names them). Run by the Job `knowledge-carry`
 * (`deploy/pulumi/src/app/knowledge-carry-job.ts`) from the frontend image, bundled at image build into
 * `dist-jobs/knowledge-carry.mjs` with the shims the jobs bundle uses (`scripts/build-jobs-bundle.ts`):
 *
 *   node dist-jobs/knowledge-carry.mjs
 *
 * Environment, besides the BFF's: `KNOWLEDGE_SINGLE_OPERATOR=true` (this pod only), `KNOWLEDGE_CARRY_DEPLOYMENT`
 * (the stack: the source deployment carries nothing to itself), `KNOWLEDGE_CARRY_PROMOTION` (what the trail names
 * as the promotion: the image tag), `KNOWLEDGE_CARRY_WAIT_MINUTES` (default 30). Every step logs one JSON line;
 * the exit code is 0 when every bundle is carried or skipped, 1 otherwise. On a target deployment it then derives
 * every live project's building class again from the released records (`rederiveBuildingClasses`, the step the
 * rollover's "Existing projects" names), and a failed project or a cut run is a 1 too: the Job's retry runs it again.
 */

import 'server-only'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { closeDb } from '@/lib/db'
import { parseManifest } from '@/lib/base-knowledge/platform/carry-manifest'
import { runCarry } from '@/lib/base-knowledge/platform/carry'
import { rederiveBuildingClasses } from '@/lib/project-intake/rederive'

const DIR = path.resolve(process.env.KNOWLEDGE_CARRY_DIR ?? path.join(process.cwd(), 'config', 'knowledge-releases'))

function log(step: string, facts: Record<string, unknown> = {}): void {
  // oxlint-disable-next-line no-console -- the Job's log is its report: one JSON line per step
  console.log(JSON.stringify({ at: new Date().toISOString(), carry: step, ...facts }))
}

async function main(): Promise<number> {
  const deployment = (process.env.KNOWLEDGE_CARRY_DEPLOYMENT ?? '').trim()
  const promotion = (process.env.KNOWLEDGE_CARRY_PROMOTION ?? '').trim()
  if (!deployment || !promotion) {
    log('refused', { why: 'KNOWLEDGE_CARRY_DEPLOYMENT and KNOWLEDGE_CARRY_PROMOTION must be set' })
    return 1
  }
  const waitMinutes = Number(process.env.KNOWLEDGE_CARRY_WAIT_MINUTES ?? '30')
  const manifest = parseManifest(JSON.parse(await readFile(path.join(DIR, 'manifest.json'), 'utf8')))
  log('started', { deployment, promotion, source: manifest.sourceDeployment, bundles: manifest.bundles.map((entry) => entry.file) })
  const outcomes = await runCarry(manifest, (file) => readFile(path.join(DIR, file)), {
    deployment,
    promotion,
    log,
    waitMs: (Number.isFinite(waitMinutes) && waitMinutes > 0 ? waitMinutes : 30) * 60_000,
  })
  log('finished', { outcomes })
  if (deployment === manifest.sourceDeployment || outcomes.length === 0) return 0
  // The one-time re-derivation the rollover asks for once a country is released (`rederive.ts`): idempotent,
  // so a retried Job that finds every bundle already carried runs it again and writes only what is behind.
  const rederived = await rederiveBuildingClasses()
  log('building classes rederived', { ...rederived })
  return rederived.failed === 0 && rederived.complete ? 0 : 1
}

let code = 1
try {
  code = await main()
} catch (error) {
  log('failed', { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) })
} finally {
  await closeDb().catch(() => undefined)
}
process.exit(code)
