// @ts-check
/**
 * GRID BFF job worker — the entry point of the `bff-jobs` pool (ADR-0079, ADR-0150).
 *
 * Dedicated pod (frontend image, `node workers/jobs/index.js`), internal only:
 * no Service, no HTTPRoute. It imports the BFF's services, bundled at image
 * build into `dist-jobs/slice.mjs` (`scripts/build-jobs-bundle.ts`), and runs
 * the Hatchet worker for the `bff-job` task in this process, so the heavy work a
 * job does (walking ten thousand documents, converting an office file, parsing
 * an IFC) runs in THIS pod and never in a user-facing frontend pod that also
 * proxies chat. Hatchet decides which job runs when, fairly across
 * organizations; the job's row in `bff_job_queue` is what a run reads and
 * leaves behind (`bff/jobs-queue/hatchet-task.ts`).
 *
 * The pod answers its probes' `/api/healthz` on `PORT` itself: an answer means
 * this process's event loop is turning.
 *
 * On SIGTERM the worker stops taking runs and lets the ones in hand finish for
 * up to `BFF_JOBS_DRAIN_SECONDS`; the row of a slice cut off then is given back
 * (`shutdownSliceHost`, `releaseInFlightJobs`), and the run is retried by
 * Hatchet on another pod, which takes the row at once, from the progress it
 * saved. A give-back that fails leaves the row to the stale window.
 *
 * Environment (the BFF's own, `frontendEnv`, plus):
 *   HATCHET_CLIENT_TOKEN, HATCHET_CLIENT_HOST_PORT, HATCHET_CLIENT_TLS_STRATEGY,
 *   HATCHET_CLIENT_NAMESPACE   - the SDK's own connection settings
 *   BFF_JOBS_CONCURRENCY        - runs one replica takes at once (default 2)
 *   BFF_JOBS_DRAIN_SECONDS      - SIGTERM budget to finish the runs in hand (default 60)
 *   BFF_JOBS_STALE_SECONDS      - a held row whose run is silent this long is taken over (default 180, at least the slice timeout plus 60)
 *   BFF_JOBS_MAX_ATTEMPTS       - attempts one job gets before it is dead (default 3)
 *   BFF_JOBS_RETRY_BACKOFF_SECONDS - wait before a failed job's second attempt, doubling per attempt, at most 15 min; 0 retries at once (default 30)
 *   BFF_JOBS_DEAD_RETENTION_DAYS - how long a dead job is kept before it is deleted (default 14)
 *   BFF_JOBS_MAX_PER_ORG        - most runs one organization has at once fleet-wide; 0 = one replica's slots (default 0)
 *   BFF_JOBS_SLICE_TIMEOUT_MS   - ceiling on one run (default 300000)
 */

const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { initOtelLogs } = require('../../observability/otel-logs')
const { initOtelMetrics, shutdownOtelMetrics } = require('../../observability/otel-metrics')

const LOG = '[bff-jobs]'

/** The bundle `scripts/build-jobs-bundle.ts` writes, beside `workers/` in the image. */
const SLICE_BUNDLE = path.join(__dirname, '..', '..', 'dist-jobs', 'slice.mjs')
/** What the bundle gets to flush after the drain, as `server.js` gives its hooks. */
const HOST_SHUTDOWN_MS = 2000

/**
 * @typedef {object} JobWorker
 * @property {Promise<void>} done   settles when the worker stops; rejects when it could not run
 * @property {() => Promise<void>} stop
 */

/**
 * What `dist-jobs/slice.mjs` exports (`bff/jobs-queue/slice-entry.ts`).
 *
 * @typedef {object} SliceBundle
 * @property {() => Promise<void>} initSliceHost
 * @property {() => Promise<void>} shutdownSliceHost
 * @property {(name: string) => Promise<JobWorker>} startJobWorker
 */

/**
 * @param {string | undefined} raw
 * @param {number} fallback
 */
function toInt(raw, fallback) {
  const n = parseInt(raw ?? '', 10)
  return Number.isFinite(n) && n >= 1 ? n : fallback
}

/** @param {NodeJS.ProcessEnv} env */
function readConfig(env) {
  return {
    port: toInt(env.PORT, 3000),
    drainMs: toInt(env.BFF_JOBS_DRAIN_SECONDS, 60) * 1000,
    workerName: `bff-jobs-${env.HOSTNAME || os.hostname()}`,
  }
}

/**
 * The probes' `/api/healthz`.
 *
 * @param {number} port
 * @returns {Promise<import('node:http').Server>}
 */
function serveHealth(port) {
  const server = http.createServer((req, res) => {
    const ok = req.method === 'GET' && (req.url ?? '').split('?')[0] === '/api/healthz'
    res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' })
    res.end(JSON.stringify(ok ? { status: 'ok' } : { error: 'Not found' }))
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => resolve(server))
  })
}

/** @param {number} ms */
const after = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref())

/**
 * Start the worker, and say how to stop it in order: the worker first (its runs
 * finish or are cut off at the drain budget), then the bundle's flush.
 *
 * @param {ReturnType<typeof readConfig>} config
 * @param {{ importBundle?: () => Promise<SliceBundle>, serveHealth?: typeof serveHealth, process?: Pick<NodeJS.Process, 'on'> }} [deps]
 */
async function startJobHost(config, deps = {}) {
  // As the Next server does (`process-error-handlers.js` in next): a promise a
  // service started and did not await, rejecting late, is logged, not fatal.
  // Fatal here would take every run in the pod down with it.
  const proc = deps.process ?? process
  proc.on('unhandledRejection', (reason) => console.error(`${LOG} unhandledRejection:`, reason))
  proc.on('uncaughtException', (error) => console.error(`${LOG} uncaughtException:`, error))
  const importBundle = deps.importBundle ?? (() => import(pathToFileURL(SLICE_BUNDLE).href))
  const bundle = await importBundle()
  await bundle.initSliceHost()
  const health = await (deps.serveHealth ?? serveHealth)(config.port)
  const worker = await bundle.startJobWorker(config.workerName)
  return {
    done: worker.done,
    /** @returns {Promise<boolean>} whether the runs in hand finished inside the budget */
    stop: async () => {
      const drained = await Promise.race([worker.stop().then(() => true), after(config.drainMs).then(() => false)])
      health.close()
      // A flush that hangs must not hold the pod past its grace period.
      await Promise.race([
        bundle.shutdownSliceHost().catch((/** @type {unknown} */ error) => console.warn(`${LOG} the job host did not flush:`, error)),
        after(HOST_SHUTDOWN_MS),
      ])
      return drained
    },
  }
}

async function main() {
  // No-op without OTEL_EXPORTER_OTLP_ENDPOINT (ADR-0029 capability gate).
  initOtelLogs()
  initOtelMetrics()
  const config = readConfig(process.env)
  let stopping = false
  /** @type {Awaited<ReturnType<typeof startJobHost>> | null} */
  let host = null

  /** @param {string} signal */
  async function shutdown(signal) {
    if (stopping) return
    stopping = true
    console.log(`${LOG} ${signal}: draining for up to ${config.drainMs}ms`)
    const drained = host ? await host.stop() : true
    if (!drained) console.warn(`${LOG} drain budget spent; Hatchet retries what was cut off`)
    await shutdownOtelMetrics().catch(() => {})
    process.exit(0)
  }
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))

  host = await startJobHost(config)
  console.log(`${LOG} running the bff-job task on Hatchet as ${config.workerName}`)
  host.done.then(
    () => {
      if (!stopping) {
        console.error(`${LOG} the Hatchet worker stopped on its own; exiting`)
        process.exit(1)
      }
    },
    (/** @type {unknown} */ error) => {
      console.error(`${LOG} the Hatchet worker failed:`, error)
      process.exit(1)
    },
  )
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`${LOG} failed to start:`, error)
    process.exit(1)
  })
}

module.exports = { readConfig, startJobHost }
