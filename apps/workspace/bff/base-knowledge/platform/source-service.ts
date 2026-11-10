/**
 * A country's public sources on the platform door (ADR-0174, design §4.5):
 * `source-test`, `source-status` and `source-credential-set`, beside the
 * change-request flow that proposes and publishes a source record.
 *
 * - **source-test** runs the record's recorded fixtures (no live call) and, on
 *   request, one live probe: the source as the request under test holds it
 *   (its `testing` hosts, usable by that request alone for 24 hours), else as
 *   published. A key nothing registers is a 404: no egress to an unregistered host.
 * - **source-status** lists every configured source: its hosts and their
 *   state, its monitor's last check, the freshness lag, whether a key is set
 *   (never the key), and the open request a monitor filed.
 * - **source-credential-set** stores a key write-only, on the person's yes.
 *
 * Reads take `platform:settings:view`, the live probe and the key
 * `platform:settings:manage`; all of it answers 403 until the platform has the
 * `platform-base-knowledge` flag (`requirePlatform`).
 */

import 'server-only'
import { and, eq, inArray } from 'drizzle-orm'
import { NotFoundError, ServiceUnavailableError, UnprocessableError } from '@/lib/api/errors'
import type { UserSession } from '@/lib/auth/types'
import { recordAuditEvent } from '@/lib/audit/service'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { getPlatformOrganizationId } from '@/lib/authz/platform'
import { requirePersonDecision } from '@/lib/agent-api/person-decision'
import { knowledgeRecords } from '@/lib/db/schema/knowledge-records'
import { knowledgeChangeRequests } from '@/lib/db/schema/knowledge-platform'
import { CaptureFetchError, callPublicSources, refusalDetail } from './capture-fetch'
import { configuredSource } from './onboarding'
import { checkSourceConfig, type SourceCheck } from './source-checks'
import {
  activeSources,
  credentialView,
  type CredentialView,
  draftSources,
  monitorStates,
  type MonitorState,
  type RegisteredSource,
  sourceRecordId,
  storeSourceCredential,
  usableSource,
} from './sources'
import { requirePlatform } from './service-gate'
import { platformTransaction } from './store'

/** What one probe saw (`POST /v1/public-sources/probe`). */
export interface ProbeAnswer {
  changed: boolean
  termsChanged: boolean
  termsUnwatched: string
  current: { etag: string; sha256: string; version: string; termsSha256: string }
  url: string
  contentType: string
  bytes: number
  text: string | null
  anchors: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** One probe of a registered source against what was seen last. Throws {@link CaptureFetchError} on any failure. */
export async function probeSource(
  configured: { config: Record<string, unknown>; credential?: string },
  previous: { etag?: string | null; sha256?: string | null; version?: string | null; termsSha256?: string | null },
): Promise<ProbeAnswer> {
  const answer = await callPublicSources('/v1/public-sources/probe', {
    ...configured,
    previous: {
      etag: previous.etag ?? '',
      sha256: previous.sha256 ?? '',
      version: previous.version ?? '',
      termsSha256: previous.termsSha256 ?? '',
    },
  })
  if (answer.status === 200 && isRecord(answer.body) && typeof answer.body.changed === 'boolean' && isRecord(answer.body.current)) {
    return answer.body as unknown as ProbeAnswer
  }
  throw new CaptureFetchError(`The probe failed: ${refusalDetail(answer)}`, answer.status === 403 ? 403 : 502)
}

export interface SourceTestView {
  sourceKey: string
  state: 'active' | 'testing'
  hosts: string[]
  usableUntil: string | null
  fixtures: SourceCheck
  /** One live probe, when asked: what the monitor would see now. Nothing is stored. */
  live: { ok: true; url: string; bytes: number; sha256: string; etag: string; version: string; anchors: string[]; termsUnwatched: string } | { ok: false; detail: string } | null
}

/** Run a source's fixtures, and one live probe when asked, as `changeRequestId` (testing) or published. */
export async function testPlatformSource(
  session: UserSession | null,
  sourceKey: string,
  body: { changeRequestId?: string; live: boolean },
): Promise<SourceTestView> {
  await requirePlatform(session, body.live ? PLATFORM_PERMISSIONS.settingsManage : PLATFORM_PERMISSIONS.settingsView)
  const found = await platformTransaction(async (tx) => {
    const source = await usableSource(tx, sourceKey, body.changeRequestId ?? null)
    return source ? { source, configured: await configuredSource(tx, source) } : null
  })
  if (!found) {
    throw new NotFoundError(
      `No source ${sourceKey} is published, or proposed in this change request within the last 24 hours; propose it first.`,
    )
  }
  const { source, configured } = found
  let fixtures: SourceCheck
  try {
    fixtures = await checkSourceConfig(source.config)
  } catch (error) {
    if (!(error instanceof CaptureFetchError)) throw error
    throw new ServiceUnavailableError(error.message)
  }
  return {
    sourceKey,
    state: source.state,
    hosts: source.hosts,
    usableUntil: source.usableUntil?.toISOString() ?? null,
    fixtures,
    live: body.live ? await liveProbe(configured) : null,
  }
}

async function liveProbe(configured: { config: Record<string, unknown>; credential?: string }): Promise<SourceTestView['live']> {
  try {
    const seen = await probeSource(configured, {})
    return {
      ok: true,
      url: seen.url,
      bytes: seen.bytes,
      sha256: seen.current.sha256,
      etag: seen.current.etag,
      version: seen.current.version,
      anchors: seen.anchors.slice(0, 50),
      termsUnwatched: seen.termsUnwatched,
    }
  } catch (error) {
    if (!(error instanceof CaptureFetchError)) throw error
    return { ok: false, detail: error.message }
  }
}

export interface SourceStatusView {
  sourceKey: string
  recordId: string
  countryId: string
  state: 'active' | 'testing'
  /** The request a testing source is proposed in; null for a published one. */
  changeRequestId: string | null
  hosts: { host: string; state: 'active' | 'testing' | 'expired'; usableUntil: string | null }[]
  dataFlow: 'public_only' | 'site_keyed'
  monitor: {
    kind: string
    intervalHours: number
    checkedAt: string | null
    okAt: string | null
    failure: string | null
    /** Whole days since the last successful check (or since publication, before one); null for an unwatched or draft source. */
    freshnessLagDays: number | null
  }
  credential: CredentialView
  /** The open request a monitor filed for this source, if any. */
  openMonitorRequestId: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole days between `since` and `now`; what `freshness-lag-days` scores. */
export function lagDays(since: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY_MS))
}

function statusOf(
  source: RegisteredSource & { changeRequestId?: string },
  state: MonitorState | undefined,
  credential: CredentialView,
  openRequest: string | null,
  now: Date,
): SourceStatusView {
  const hostState = source.state === 'active' ? 'active' : source.usableUntil && source.usableUntil > now ? 'testing' : 'expired'
  const watched = source.state === 'active' && source.monitorKind !== 'none'
  const since = state?.okAt ?? null
  return {
    sourceKey: source.key,
    recordId: source.recordId,
    countryId: source.countryId,
    state: source.state,
    changeRequestId: source.changeRequestId ?? null,
    hosts: source.hosts.map((host) => ({ host, state: hostState, usableUntil: source.usableUntil?.toISOString() ?? null })),
    dataFlow: source.dataFlow,
    monitor: {
      kind: source.monitorKind,
      intervalHours: source.monitorIntervalHours,
      checkedAt: state?.checkedAt.toISOString() ?? null,
      okAt: state?.okAt?.toISOString() ?? null,
      failure: state?.failure ?? null,
      freshnessLagDays: watched && since ? lagDays(since, now) : null,
    },
    credential,
    openMonitorRequestId: openRequest,
  }
}

/** Every configured source, published and proposed, or the one `sourceKey` names. */
export async function platformSourceStatus(session: UserSession | null, query: { sourceKey?: string }): Promise<{ sources: SourceStatusView[] }> {
  await requirePlatform(session, PLATFORM_PERMISSIONS.settingsView)
  const now = new Date()
  const sources = await platformTransaction(async (tx) => {
    const all = [...(await activeSources(tx)), ...(await draftSources(tx, now))].filter(
      (source) => !query.sourceKey || source.key === query.sourceKey,
    )
    const ids = [...new Set(all.map((source) => source.recordId))]
    const states = await monitorStates(tx, ids)
    const open = ids.length
      ? await tx
          .select({ id: knowledgeChangeRequests.id, sourceRecordId: knowledgeChangeRequests.sourceRecordId })
          .from(knowledgeChangeRequests)
          .where(
            and(
              eq(knowledgeChangeRequests.origin, 'monitor'),
              inArray(knowledgeChangeRequests.sourceRecordId, ids),
              inArray(knowledgeChangeRequests.status, ['draft', 'submitted', 'approved']),
            ),
          )
      : []
    const openBySource = new Map(open.map((row) => [row.sourceRecordId, row.id]))
    return Promise.all(
      all.map(async (source) =>
        statusOf(source, states.get(source.recordId), await credentialView(tx, source.recordId), openBySource.get(source.recordId) ?? null, now),
      ),
    )
  })
  if (query.sourceKey && sources.length === 0) throw new NotFoundError(`No source ${query.sourceKey} is published or proposed.`)
  return { sources }
}

/**
 * Store a source's key, write-only, on the person's yes. The source must be a
 * platform record (proposed or published); the answer says only that a key is
 * set and its last four characters.
 */
export async function setPlatformSourceCredential(
  session: UserSession | null,
  sourceKey: string,
  secret: string,
): Promise<{ sourceKey: string; credential: CredentialView }> {
  const person = await requirePlatform(session, PLATFORM_PERMISSIONS.settingsManage)
  const decisionSource = requirePersonDecision('Setting the key a public source is fetched with')
  const organizationId = await getPlatformOrganizationId()
  if (!organizationId) throw new ServiceUnavailableError('The platform organization is not configured.')
  const recordId = sourceRecordId(sourceKey)
  const credential = await platformTransaction(async (tx) => {
    const [record] = await tx
      .select({ id: knowledgeRecords.id })
      .from(knowledgeRecords)
      .where(and(eq(knowledgeRecords.id, recordId), eq(knowledgeRecords.type, 'source')))
    if (!record) throw new NotFoundError(`No source ${sourceKey}; propose it in a change request first.`)
    if (/\s/.test(secret)) throw new UnprocessableError('A key has no whitespace or line break.')
    return storeSourceCredential(tx, { recordId, organizationId, secret, setBy: person.userId, decisionSource })
  })
  await recordAuditEvent({
    organizationId,
    actor: { userId: person.userId, email: person.email },
    action: 'platform.knowledge.source_credential_set',
    targetType: 'knowledge_source',
    targetId: recordId,
    metadata: { decisionSource },
  })
  return { sourceKey, credential }
}
