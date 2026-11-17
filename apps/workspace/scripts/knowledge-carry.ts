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
