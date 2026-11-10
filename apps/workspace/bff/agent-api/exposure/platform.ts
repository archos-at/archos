/**
 * Who sees each operation of the operator console (`platform` domain), and the
 * one place every one of them is classified (ADR-0160):
 *
 *  - `PLATFORM_PUBLIC`: the platform's own data and settings (models, prices,
 *    the base corpus, platform skills, limits per organization by id). Offered
 *    on the platform door, so an operator's agent (Claude onboarding a country)
 *    reaches it.
 *  - `tenantContent(reason)`: what an office or its people wrote or are, read
 *    across offices (conversations, feedback, lessons, ratings, the people
 *    behind a spend), and the writes that change offices' own state (stopping
 *    their running turns, deleting chunks from their collections). On no door: the operator's agent vendor is no processor of
 *    tenant content. Platform staff keep it in the console in the browser,
 *    where the route's own `platform:*` permission decides, as before.
 *
 * Every caller of the platform door is an outside agent (the in-product agent's
 * credential is refused there, `principal.ts`), so "withheld from any external agent client"
 * and "off the platform door" are the same rule, and `isExposedTo` enforces it
 * server-side for every listing, search, describe and call. The platform MCP
 * gateway in front of the cluster's own MCP servers holds the same line per
 * tool (`deploy/pulumi/src/platform/mcp-gateway.ts`, `tools`).
 *
 * A new console operation takes one of the two here, or in a file of its own
 * under `exposure/` spread into `EXPOSURE`. Its type admits nothing else, and
 * `platform.spec.ts` holds that a tenant-content operation stays off every door.
 */

import type { Exposure } from '../exposure.config'
import type { platformOperations } from '../catalog/platform'

/** The operator console's own data: the platform door only (ADR-0126, ADR-0160). */
export const PLATFORM_PUBLIC = {
  external: false,
  agent: false,
  platform: true,
  reason: 'the operator console is the platform operator’s, not an office’s: every write there reaches every tenant',
} as const satisfies Exposure

/** A tenant-content entry: on no door, withheld under exactly this category. */
export interface TenantContentExposure extends Exposure {
  readonly external: false
  readonly agent: false
  readonly withheld: { readonly category: 'tenant-content'; readonly reason: string }
}

/** Content of offices, read or changed across them: on no door, for staff in the console only (ADR-0160). */
export const tenantContent = (reason: string): TenantContentExposure => ({
  external: false,
  agent: false,
  withheld: { category: 'tenant-content', reason },
})

/** A console operation's entry: one of the two classes, never anything else. */
export type PlatformExposure = typeof PLATFORM_PUBLIC | TenantContentExposure

type PlatformOperationName = (typeof platformOperations)[number]['name']

const CONVERSATIONS = 'the conversations of every office, their questions and answers'
const FEEDBACK = 'product feedback people in offices wrote, with their names and emails'
const LESSONS = 'lessons distilled from offices’ down-voted turns, with the turns they came from'
const RATINGS = 'ratings of offices’ answers with the comments and expected answers people wrote, searchable by their text'

export const PLATFORM_EXPOSURE = {
  'platform-answer-feedback-digest-get': tenantContent(`a model’s summary of ${RATINGS}`),
  'platform-answer-feedback-export': tenantContent(`an export of ${RATINGS}`),
  'platform-answer-feedback-get': tenantContent(RATINGS),
  'platform-answer-feedback-options-get': tenantContent(`counts over ${RATINGS}: a search over that text answers by its count`),
  'platform-audit-portal-link': PLATFORM_PUBLIC,
  'platform-card-list': PLATFORM_PUBLIC,
  'platform-citation-health-export': tenantContent(`the flagged turns of ${CONVERSATIONS}, with what each cited`),
  'platform-citation-health-get': tenantContent('per office, the sources answers failed to cite, which can name an office’s own documents'),
  'platform-feedback-claim': tenantContent(`a write that answers with the report: ${FEEDBACK}`),
  'platform-feedback-get': tenantContent(FEEDBACK),
  'platform-feedback-list': tenantContent(FEEDBACK),
  'platform-feedback-triage': tenantContent(`a write that answers with the report: ${FEEDBACK}`),
  'platform-kill-runs': tenantContent('stops every office’s running turns and research: a write on what offices are doing, for staff in an incident'),
  'platform-knowledge-doc-class-update': PLATFORM_PUBLIC,
  'platform-knowledge-document-delete': PLATFORM_PUBLIC,
  'platform-knowledge-document-upload': PLATFORM_PUBLIC,
  'platform-knowledge-reingest': PLATFORM_PUBLIC,
  'platform-knowledge-sync': PLATFORM_PUBLIC,
  'platform-knowledge-title-update': PLATFORM_PUBLIC,
  'platform-lesson-get': tenantContent(LESSONS),
  'platform-lesson-list': tenantContent(LESSONS),
  'platform-lesson-sweep-run': tenantContent(`reads offices’ down-voted turns to distil ${LESSONS}`),
  'platform-lesson-update': tenantContent(`a write that answers with the lesson: ${LESSONS}`),
  'platform-model-defaults-get': PLATFORM_PUBLIC,
  'platform-model-defaults-update': PLATFORM_PUBLIC,
  'platform-model-search': PLATFORM_PUBLIC,
  'platform-norm-registry-get': PLATFORM_PUBLIC,
  'platform-norm-registry-update': PLATFORM_PUBLIC,
  'platform-norm-verify': PLATFORM_PUBLIC,
  'platform-org-budget-get': PLATFORM_PUBLIC,
  'platform-org-budget-update': PLATFORM_PUBLIC,
  'platform-org-storage-get': PLATFORM_PUBLIC,
  'platform-org-storage-update': PLATFORM_PUBLIC,
  'platform-org-upload-limit-update': PLATFORM_PUBLIC,
  'platform-org-usage-get': tenantContent('an office’s spend per person, with each person’s name and email'),
  'platform-overview-get': PLATFORM_PUBLIC,
  'platform-pricing-get': PLATFORM_PUBLIC,
  'platform-pricing-update': PLATFORM_PUBLIC,
  'platform-profiler-conversation-get': tenantContent(`one of ${CONVERSATIONS}, turn by turn`),
  'platform-profiler-conversation-list': tenantContent(`${CONVERSATIONS}, searchable by their text`),
  'platform-quality-scope-options': tenantContent('the names of every office’s projects'),
  'platform-reasoning-efforts-get': PLATFORM_PUBLIC,
  'platform-reasoning-efforts-update': PLATFORM_PUBLIC,
  'platform-retrieval-settings-get': PLATFORM_PUBLIC,
  'platform-retrieval-settings-update': PLATFORM_PUBLIC,
  'platform-skill-category-create': PLATFORM_PUBLIC,
  'platform-skill-category-delete': PLATFORM_PUBLIC,
  'platform-skill-category-list': PLATFORM_PUBLIC,
  'platform-skill-category-update': PLATFORM_PUBLIC,
  'platform-storage-overview': PLATFORM_PUBLIC,
  'platform-vectors-reconcile': tenantContent('deletes chunks from offices’ own search collections, and its failures can name what they held'),
} as const satisfies Record<PlatformOperationName, PlatformExposure>
