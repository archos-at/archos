import type { Exposure } from '../exposure.config'
import type { platformOperations } from '../catalog/platform'

export const PLATFORM_PUBLIC = {
  external: false,
  agent: false,
  platform: true,
  reason: 'the operator console is the platform operator’s, not an office’s: every write there reaches every tenant',
} as const satisfies Exposure

export interface TenantContentExposure extends Exposure {
  readonly external: false
  readonly agent: false
  readonly withheld: { readonly category: 'tenant-content'; readonly reason: string }
}

export const tenantContent = (reason: string): TenantContentExposure => ({
  external: false,
  agent: false,
  withheld: { category: 'tenant-content', reason },
})

export interface RetiredExposure extends Exposure {
  readonly external: false
  readonly agent: false
  readonly withheld: { readonly category: 'product-config'; readonly reason: string }
}

export const retired = (reason: string): RetiredExposure => ({
  external: false,
  agent: false,
  withheld: { category: 'product-config', reason },
})

export type PlatformExposure = typeof PLATFORM_PUBLIC | TenantContentExposure | RetiredExposure

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
  'platform-norm-registry-update': retired(
    'the norm registry takes no edits since ADR-0175 and answers 409: norms change through a change request (platform-knowledge-change-request-create)',
  ),
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
