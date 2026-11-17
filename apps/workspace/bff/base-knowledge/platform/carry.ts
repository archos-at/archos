import 'server-only'
import { sql } from 'drizzle-orm'
import { recordAuditEvent, SYSTEM_ACTORS } from '@/lib/audit/service'
import { getPlatformOrganizationId } from '@/lib/authz/platform'
import type { CarriedFrom } from '@/lib/db/schema/knowledge-platform'
import { decideInTransaction, type KnowledgeAuditAction } from './decide'
import { enqueueIndexRuns, resumeIndexRuns } from './indexing'
import { captureAs, requestSourceChecks, requestTextProblems, runKit, validateRequest } from './onboarding'
import { importReleaseAs, readCountryRelease } from './release-transfer'
import { publishChangeRequest } from './release'
import { recordIdOf } from './records'
import type { ReleaseBundle } from './release-wire'
import { singleOperator } from './single-operator'
import {
  awaitedApprovalRoles,
  canonicalJson,
  findChangeRequest,
  insertProposedRecords,
  insertReviewDecisions,
  lockChangeRequest,
  newestPerRecord,
  platformTransaction,
  readChangeRequest,
  requestRevisions,
  setChangeRequestStatus,
} from './store'
import { attachTextFromUrl } from './texts'
import { draftManifestation } from './text-store'
import { type CarriedBundle, type CarryManifest, CarryRefused, checkCarryOrder, verifiedBundle } from './carry-manifest'
import { retireLegacyCopies, settleTexts, type CarryLog } from './carry-finish'
import { proposedRecordSchema, type ProposedRecord } from './wire'

export const CARRY_ACTOR = SYSTEM_ACTORS.knowledgeCarry

const CARRIED = { by: CARRY_ACTOR, decisionSource: 'carried' as const }

export interface CarryContext {
  deployment: string
  promotion: string
  log: CarryLog
  waitMs: number
  pollMs?: number
}

export interface CarryOutcome {
  countryId: string
  status: 'carried' | 'skipped'
  changeRequestId: string | null
  why: string
}

export class CarryFailed extends Error {
  override name = 'CarryFailed'
}

const carriedFromOf = (manifest: CarryManifest, entry: CarriedBundle, promotion: string): CarriedFrom => ({
  sha256: entry.sha256,
  sourceDeployment: manifest.sourceDeployment,
  sourceSeq: entry.seq,
  promotion,
})

const reasonOf = (from: CarriedFrom, countryId: string) =>
  `Carried from the ${from.sourceDeployment} release of ${countryId} (seq ${from.sourceSeq}, bundle sha256 ${from.sha256}) by the promotion ${from.promotion}: reviewed and approved there, the bundle reviewed in the promotion PR (ADR-0181).`

export async function runCarry(manifest: CarryManifest, readFile: (file: string) => Promise<Buffer>, ctx: CarryContext): Promise<CarryOutcome[]> {
  if (manifest.bundles.length === 0) {
    ctx.log('nothing to carry', { manifest: 'no bundles' })
    return []
  }
  const bundles: ReleaseBundle[] = []
  for (const entry of manifest.bundles) {
    bundles.push(verifiedBundle(entry, await readFile(entry.file)))
    ctx.log('bundle verified', { file: entry.file, countryId: entry.countryId, seq: entry.seq, sha256: entry.sha256 })
  }
  checkCarryOrder(bundles.map((bundle) => ({ countryId: bundle.countryId, requires: bundle.requires.flatMap((row) => (row.countryId ? [row.countryId] : [])) })))
  if (ctx.deployment === manifest.sourceDeployment) return sourceDeploymentSkips(manifest, bundles, ctx)
  if (!singleOperator()) throw new CarryRefused('KNOWLEDGE_SINGLE_OPERATOR is not true in the carry process; the carry Job sets it on its own pod')
  const outcomes: CarryOutcome[] = []
  for (const [index, entry] of manifest.bundles.entries()) {
    const outcome = await carryCountry(bundles[index]!, carriedFromOf(manifest, entry, ctx.promotion), ctx)
    if (outcome.changeRequestId) {
      const resumed = await resumeIndexRuns(await getPlatformOrganizationId(), outcome.changeRequestId)
      if (resumed.enqueued + resumed.failed > 0) ctx.log('index runs resumed', { changeRequestId: outcome.changeRequestId, ...resumed })
      await settleTexts(entry, outcome.changeRequestId, ctx)
    }
    outcomes.push(outcome)
  }
  await retireLegacyCopies(bundles, ctx)
  return outcomes
}

async function sourceDeploymentSkips(manifest: CarryManifest, bundles: readonly ReleaseBundle[], ctx: CarryContext): Promise<CarryOutcome[]> {
  const outcomes: CarryOutcome[] = []
  for (const bundle of bundles) {
    const current = await readCountryRelease(bundle.countryId).catch(() => null)
    const same = current !== null && canonicalJson(current) === canonicalJson(bundle)
    const why = same ? 'this is the source deployment, and its stable release is the bundle' : 'this is the source deployment; its stable release has moved on since the bundle'
    ctx.log('skipped', { countryId: bundle.countryId, deployment: ctx.deployment, source: manifest.sourceDeployment, stableEqualsBundle: same })
    outcomes.push({ countryId: bundle.countryId, status: 'skipped', changeRequestId: null, why })
  }
  return outcomes
}

async function heldCarry(sha256: string): Promise<string | null> {
  const [row] = await platformTransaction((tx) =>
    tx.execute<{ id: string }>(sql`
      SELECT id FROM knowledge_change_requests
      WHERE carried_from ->> 'sha256' = ${sha256} AND status = 'published' LIMIT 1`),
  )
  return row?.id ?? null
}

async function ownRelease(countryId: string): Promise<string | null> {
  const [row] = await platformTransaction((tx) =>
    tx.execute<{ id: string }>(sql`
      SELECT r.id FROM knowledge_records r
      JOIN knowledge_revisions v ON v.revision_id = r.head_revision_id
      JOIN knowledge_change_requests c ON c.id = v.change_request_id
      WHERE r.organization_id IS NULL AND r.country_id = ${countryId} AND c.carried_from IS NULL LIMIT 1`),
  )
  return row?.id ?? null
}

async function carryCountry(bundle: ReleaseBundle, from: CarriedFrom, ctx: CarryContext): Promise<CarryOutcome> {
  const { countryId } = bundle
  const held = await heldCarry(from.sha256)
  if (held) {
    ctx.log('skipped', { countryId, why: 'stable holds a request carried from this bundle', changeRequestId: held })
    return { countryId, status: 'skipped', changeRequestId: held, why: 'already carried' }
  }
  const own = await ownRelease(countryId)
  if (own) throw new CarryRefused(`${countryId}'s ${own} was released on this deployment by its own review; the carry does not write over it`)
  const imported = await importReleaseAs(CARRY_ACTOR, { bundle, title: `${countryId}: carried from ${from.sourceDeployment} release ${from.sourceSeq}` }, { proposedBy: 'agent', carriedFrom: from })
  const id = imported.changeRequestId
  ctx.log('imported', { countryId, changeRequestId: id, status: imported.status, requestStatus: imported.requestStatus, records: imported.records })
  const request = await findChangeRequest(id)
  if (!request?.carriedFrom) throw new CarryRefused(`${id} holds this bundle but was imported by a person, not carried; reject it, then run the carry again`)
  if (request.status === 'draft') await prepareDraft(id, bundle, ctx)
  if ((await findChangeRequest(id))?.status === 'submitted') await approveCarried(id, from, countryId, ctx)
  if ((await findChangeRequest(id))?.status === 'approved') await publishCarried(id, ctx)
  const status = (await findChangeRequest(id))?.status
  if (status !== 'published') throw new CarryFailed(`${id} stands ${status ?? 'nowhere'} after the carry; it should be published`)
  return { countryId, status: 'carried', changeRequestId: id, why: 'published to stable' }
}

async function prepareDraft(id: string, bundle: ReleaseBundle, ctx: CarryContext): Promise<void> {
  for (const text of bundle.texts) {
    const current = await platformTransaction((tx) => draftManifestation(tx, id, `manifestation:${text.manifestationKey}`))
    if (current?.text?.origin && current.text.sha256 === text.sha256) continue
    if (!text.url || !text.sourceId) throw new CarryRefused(`${text.fileName} was uploaded on the source; the carry attaches only a text it can fetch from its URL`)
    const attached = await attachTextFromUrl(CARRY_ACTOR, id, { manifestationKey: text.manifestationKey, sourceId: text.sourceId, url: text.url }, 'agent')
    ctx.log('text attached', { changeRequestId: id, fileName: attached.text.corpusFile, sha256: attached.text.sha256, stored: attached.stored })
  }
  await captureFixtures(id, ctx)
  const sourceChecks = await requestSourceChecks(id)
  await platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, id)
    if (request?.status !== 'draft') throw new CarryFailed(`${id} left draft while the carry prepared it`)
    const validation = await validateRequest(tx, request, sourceChecks)
    if (!validation.valid) throw new CarryFailed(`${id} fails ${validation.problems.length} check(s): ${JSON.stringify(validation.problems.slice(0, 10))}`)
    await setChangeRequestStatus(tx, id, 'submitted', 'submittedAt')
  })
  ctx.log('submitted', { changeRequestId: id })
}

type SourceRecord = Extract<ProposedRecord, { type: 'source' }>

async function captureFixtures(id: string, ctx: CarryContext): Promise<void> {
  const sources = await platformTransaction(async (tx) =>
    newestPerRecord(await requestRevisions(tx, id)).flatMap((revision) => {
      const parsed = proposedRecordSchema.safeParse(revision.provenance.proposal)
      return parsed.success && parsed.data.type === 'source' ? [parsed.data] : []
    }),
  )
  for (const source of sources) {
    const open = source.fixtures.flatMap((fixture) => Object.entries(fixture.responses).filter(([, response]) => 'captureId' in response && response.captureId === null).map(([url]) => url))
    if (open.length === 0) continue
    const captured = new Map<string, string>()
    for (const url of new Set(open)) captured.set(url, (await captureAs(CARRY_ACTOR, id, { basis: 'fetched', sourceId: source.key, url })).captureId)
    const next: SourceRecord = {
      ...source,
      fixtures: source.fixtures.map((fixture) => ({
        ...fixture,
        responses: Object.fromEntries(Object.entries(fixture.responses).map(([url, response]) => [url, captured.has(url) && 'captureId' in response ? { captureId: captured.get(url)! } : response])),
      })),
    }
    await platformTransaction(async (tx) => {
      const request = await lockChangeRequest(tx, id)
      if (!request) throw new CarryFailed(`${id} is gone`)
      const problems = await runKit(tx, request, [next], new Map([[recordIdOf(next), []]]))
      if (problems.length > 0) throw new CarryFailed(`${recordIdOf(next)} fails ${problems.length} check(s) with its captures: ${JSON.stringify(problems.slice(0, 5))}`)
      await insertProposedRecords(tx, request, [next], { createdBy: CARRY_ACTOR, proposedBy: 'agent' })
    })
    ctx.log('fixtures captured', { changeRequestId: id, recordId: recordIdOf(next), urls: [...captured.keys()] })
  }
}

async function approveCarried(id: string, from: CarriedFrom, countryId: string, ctx: CarryContext): Promise<void> {
  const view = await readChangeRequest(id)
  if (!view) throw new CarryFailed(`${id} is gone`)
  const note = `Accepted on ${from.sourceDeployment} (release seq ${from.sourceSeq}); carried with bundle sha256 ${from.sha256}.`
  const open = view.revisions.flatMap((revision) =>
    revision.claims.filter((claim) => claim.decision !== 'accepted').map((claim) => ({ revisionId: revision.revisionId, claimPath: claim.path, decision: 'accepted' as const, sourceChecked: true, note })),
  )
  for (let start = 0; start < open.length; start += 1000) {
    await platformTransaction((tx) => insertReviewDecisions(tx, id, CARRIED, open.slice(start, start + 1000)))
  }
  ctx.log('reviewed', { changeRequestId: id, verdicts: open.length })
  const problems = await requestTextProblems(id)
  if (problems.length > 0) throw new CarryFailed(`${id}: a text is not the one proposed (${JSON.stringify(problems.slice(0, 5))})`)
  const reason = reasonOf(from, countryId)
  for (const role of ['domain_expert', 'counsel', 'privacy_reviewer'] as const) {
    if ((await findChangeRequest(id))?.status !== 'submitted') break
    const approved = (await readChangeRequest(id))?.approvals.some((approval) => approval.role === role) ?? false
    if (approved) continue
    if (role !== 'domain_expert' && !(await platformTransaction((tx) => awaitedApprovalRoles(tx, id))).includes(role)) continue
    const decided = await platformTransaction((tx) => decideInTransaction(tx, id, { decision: 'approve', role, override: { reason } }, CARRIED))
    await carryAudit('platform.knowledge.change_request_approved_alone', id, {
      role,
      decisionSource: 'carried',
      reason,
      revisions: decided.alone.join(',').slice(0, 500),
      revisionCount: decided.alone.length,
      awaiting: decided.awaiting.join(','),
    })
    ctx.log('approved', { changeRequestId: id, role, status: decided.status, approval: decided.approval, secondReview: decided.secondReview })
  }
}

async function publishCarried(id: string, ctx: CarryContext): Promise<void> {
  const previewed = (await readChangeRequest(id))?.releases.some((move) => move.channel === 'preview' && move.action === 'publish') ?? false
  if (!previewed) {
    const preview = await publishChangeRequest(id, 'preview', CARRIED)
    await carryAudit('platform.knowledge.published', id, { channel: 'preview', moved: preview.moved, decisionSource: 'carried', indexFailed: 0 })
    ctx.log('published', { changeRequestId: id, channel: 'preview', moved: preview.moved })
  }
  const stable = await publishChangeRequest(id, 'stable', CARRIED)
  const indexing = await enqueueIndexRuns(await getPlatformOrganizationId(), stable.indexRuns)
  await carryAudit('platform.knowledge.published', id, { channel: 'stable', moved: stable.moved, decisionSource: 'carried', indexFailed: indexing.failed })
  ctx.log('published', { changeRequestId: id, channel: 'stable', moved: stable.moved, indexRuns: stable.indexRuns.length, enqueueFailed: indexing.failed })
  if (indexing.failed > 0) throw new CarryFailed(`${indexing.failed} index run(s) of ${id} were not enqueued; platform-knowledge-index-status names them`)
}

async function carryAudit(action: KnowledgeAuditAction, targetId: string, metadata: Record<string, string | number | boolean>): Promise<void> {
  const organizationId = await getPlatformOrganizationId()
  if (!organizationId) return
  await recordAuditEvent({ organizationId, actor: { userId: CARRY_ACTOR }, action, targetType: 'knowledge_change_request', targetId, metadata })
}
