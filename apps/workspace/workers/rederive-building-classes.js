// @ts-check
/**
 * Derive every live project's building class again from the released setup records, once, and exit
 * (`bff/project-intake/rederive.ts`, `docs/design/international/rollover-to-prod.md`, „Existing projects").
 *
 * Run after a country's setup records are published, from the frontend image:
 *
 *   node workers/rederive-building-classes.js [--deadline-minutes 15]
 *   bun run rederive:building-classes            # the same, from apps/workspace (build the bundle first: bun run build:jobs)
 *
 * It imports the BFF's services from the jobs bundle (`dist-jobs/slice.mjs`, `scripts/build-jobs-bundle.ts`),
 * with the BFF's own environment (APP_DATABASE_URL and the rest of `frontendEnv`). Idempotent: a second run
 * writes only what is still behind. Before a country is released it changes nothing. Prints one JSON line
 * with the counts; exits 1 when a project failed or the deadline cut the run short.
 */

const path = require('node:path')
const { pathToFileURL } = require('node:url')

const SLICE_BUNDLE = path.join(__dirname, '..', 'dist-jobs', 'slice.mjs')

/** @param {string[]} argv */
function deadlineMs(argv) {
  const index = argv.indexOf('--deadline-minutes')
  const minutes = index >= 0 ? Number(argv[index + 1]) : 15
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : 15 * 60 * 1000
}

async function main() {
  const bundle = await import(pathToFileURL(SLICE_BUNDLE).href)
  const result = await bundle.rederiveBuildingClasses({ deadlineMs: deadlineMs(process.argv) })
  // oxlint-disable-next-line no-console -- the run's one result line, for the operator and the Job's log
  console.log(`[rederive_building_classes] ${JSON.stringify(result)}`)
  return result.failed === 0 && result.complete ? 0 : 1
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error('[rederive_building_classes] the run failed', error)
    process.exit(1)
  }
)
