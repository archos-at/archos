/**
 * The log lines of the background-work sweep (`reconcileBackgroundWork` in
 * `./index.js`), and the scheduler's log prefix. Pure: the counts the BFF
 * answered in, the lines to print out. Logs only what changed something or
 * failed; counts only, never an id or an address.
 */

const LOG = '[job-scheduler]'

/** Every line one background-work sweep's counts print, in order: documents, report filings, project mail. */
function backgroundWorkLines(counts) {
  const lines = []
  const documents = counts?.documents
  const filings = counts?.filings
  if (documents && (documents.requeued > 0 || documents.failed > 0 || documents.errors > 0)) {
    lines.push(
      `${LOG} background work sweep, documents: checked ${documents.checked}, requeued ${documents.requeued}, ` +
        `failed ${documents.failed}, gone ${documents.gone}, errors ${documents.errors}`,
    )
  }
  if (filings && (filings.filed > 0 || filings.failed > 0 || filings.errors > 0)) {
    lines.push(
      `${LOG} background work sweep, report filings: checked ${filings.checked}, filed ${filings.filed}, ` +
        `failed ${filings.failed}, waiting ${filings.waiting}, errors ${filings.errors}`,
    )
  }
  return [...lines, ...inboundMailSweepLines(counts?.inboundMail)]
}

/**
 * The log lines of the project mail sweeps (`lib/inbound-mail/sweep.ts`,
 * ADR-0137): one per sweep that did something or failed, each count by name
 * (`expired: checked 3, expired 2, parts 5, errors 0`). A sweep that only
 * looked says nothing, as the halves above. Counts only: no id, no address.
 * An older BFF sends no `inboundMail`, which logs nothing.
 */
function inboundMailSweepLines(inboundMail) {
  if (!inboundMail || typeof inboundMail !== 'object') return []
  const lines = []
  for (const [sweep, counts] of Object.entries(inboundMail)) {
    if (!counts || typeof counts !== 'object') continue
    const acted = Object.entries(counts).some(([name, value]) => name !== 'checked' && Number(value) > 0)
    if (!acted) continue
    const parts = Object.entries(counts).map(([name, value]) => `${name} ${value}`)
    lines.push(`${LOG} background work sweep, project mail ${sweep}: ${parts.join(', ')}`)
  }
  return lines
}

module.exports = { LOG, backgroundWorkLines, inboundMailSweepLines }
