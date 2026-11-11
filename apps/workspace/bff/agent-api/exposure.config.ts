/**
 * Who sees each capability (ADR-0122, amendment of 2026-10-21): the one file that decides it.
 *
 * One entry per operation, the catalog's (`catalog/`) and the agent's read
 * tools (`backend-operations.ts`). Three audiences, one column each:
 *
 *  - `external`: an outside agent on an office door (`/api/mcp`, the A2A door)
 *    and the OpenAPI document.
 *  - `agent`: the in-product agent on its workspace door. `true` offers it;
 *    `'native:<tool>'` says the agent does this with that native tool (its name in
 *    `configs/config_oib_openrouter.yml`, a group's as `<group>__<function>`),
 *    so the door hides the operation from the agent; `false` hides it for the
 *    `reason` the entry gives.
 *  - `platform`: platform staff on the platform door (ADR-0126). Only the
 *    `platform` domain, and that domain on no other door. Each console
 *    operation is platform-public or tenant content (`exposure/platform.ts`,
 *    ADR-0160); tenant content is on no door at all.
 *  - `app`: an MCP Apps view in an outside agent's host (ADR-0142). Set only
 *    on an app-only tool (`catalog/app-views.ts`): a control on a card the
 *    person presses, listed with `_meta.ui.visibility: ['app']` so the host
 *    keeps it from the model, and offered to no other audience.
 *
 * `withheld` keeps an operation in the catalog and on no door, with its
 * category and reason (the amendments' five categories); offering it again is
 * replacing the entry. Every entry that is not plainly offered to both office
 * audiences says why in `reason`.
 *
 * This decides VISIBILITY: what is listed, found, described and called.
 * `policy.ts` (`canSee`) reads it for every door. It does not decide whether a
 * proposal Piloti already filed may apply: the applier keeps its own reasons
 * (`lib/proposals/operation-applier.ts`), so hiding an operation behind a
 * native tool never fails a card the person is about to accept.
 *
 * `sensitivity` stays on the operation: it is a property of the act (it widens
 * access, touches a secret, turns a control down), and whether a caller may see
 * one is decided per call from the organization's opt-in flags and the token's
 * step-up scope, which no static file can know. The entries of sensitive
 * operations say the ceiling: never Piloti (`exposure.config.spec.ts` holds
 * that), an external agent only behind those guards.
 *
 * Changing an entry changes `tests/fixtures/exposure.json`, the docs' and Python's copy (command in its spec).
 */

import type { BackendOperationName } from './backend-operations'
import type { OperationName } from './catalog'
import type { AppToolName } from './catalog/app-views'
import {
  APP_ONLY,
  ASK,
  CANVAS,
  DECISION,
  MEMORY,
  PERSONAL_MEMORY,
  NATIVE_READ,
  OFFERED,
  SENSITIVE,
  SKILL_READ,
  TASK,
} from './exposure-presets'
import { MAIL_EXPOSURE } from './exposure-mail'
import { BASE_KNOWLEDGE_EXPOSURE } from './exposure-base-knowledge'
import { PLATFORM_EXPOSURE } from './exposure/platform'
import { PLATFORM_KNOWLEDGE_EXPOSURE } from './exposure/platform-knowledge'
import { PLATFORM_SKILL_EXPOSURE } from './exposure/platform-skills'

/**
 * Why an operation is withheld from agents. `external-service`: a service we
 * only proxy or switch, which a calling agent already has its own tool for.
 * `product-config`: how the agent itself works for the office (models, keys,
 * budgets, policies, settings). `model-compute`: model work the caller can do
 * itself whose result is no office artifact. `ui-state`: this person's own
 * screen or device state. `evidence`: bytes kept as proof, which no model reads
 * (a mail's original `.eml`, ADR-0137; ADR-0122's amendment of 2026-10-22).
 * `tenant-content`: a console operation that reads what offices or their people
 * wrote, across offices; platform staff read it in the console in the browser,
 * and no agent client does, the operator's own included (ADR-0160).
 */
export const WITHHELD_CATEGORIES = [
  'external-service',
  'product-config',
  'model-compute',
  'ui-state',
  'evidence',
  'tenant-content',
] as const
export type WithheldCategory = (typeof WITHHELD_CATEGORIES)[number]

export interface Withholding {
  readonly category: WithheldCategory
  /** One line a reviewer can disagree with. */
  readonly reason: string
}

/** A native tool of Piloti's, as the model binds it: `native:remember`, `native:canvas__mark`. */
export type NativeTool = `native:${string}`

export interface Exposure {
  /** Offered to an outside agent on an office door, and in the OpenAPI document. */
  readonly external: boolean
  /** Offered to in-product Piloti, or done by Piloti with the named native tool instead. */
  readonly agent: boolean | NativeTool
  /** Offered on the platform door (the `platform` domain only). */
  readonly platform?: true
  /** An app-only tool: offered to an MCP Apps view in an outside agent's host, never to a model (ADR-0142). */
  readonly app?: true
  /** On no door at all, with why. */
  readonly withheld?: Withholding
  /** Why the entry is not simply offered to both office audiences. */
  readonly reason?: string
}

/** On no door at all, for the amendment's `category` and a `reason` a reviewer can disagree with. */
const withheld = (category: WithheldCategory, reason: string) =>
  ({ external: false, agent: false, withheld: { category, reason } }) as const satisfies Exposure

/**
 * Every operation, in catalog order (domain, then name), then the read tools,
 * then the app-only tools.
 * A name that is no operation, or an operation without an entry, does not compile.
 */
export const EXPOSURE = {
  // projects
  'project-cleanup-confirm': OFFERED,
  'project-cleanup-propose': OFFERED,
  'project-consistency-check': OFFERED,
  'project-create': OFFERED,
  'project-delete': OFFERED,
  'project-experience-extract': OFFERED,
  'project-get': OFFERED,
  'project-intake-complete': OFFERED,
  'project-intake-decide': OFFERED,
  'project-intake-definition-get': OFFERED,
  'project-intake-get': OFFERED,
  'project-intake-start': OFFERED,
  'project-list': OFFERED,
  'project-member-add': SENSITIVE,
  'project-member-list': OFFERED,
  'project-member-remove': SENSITIVE,
  'project-memory-create': { external: true, agent: 'native:remember', reason: MEMORY },
  'project-memory-delete': OFFERED,
  'project-memory-list': OFFERED,
  'project-memory-update': OFFERED,
  'project-overview-get': OFFERED,
  'project-period-set': OFFERED,
  'project-person-add': OFFERED,
  'project-person-delete': OFFERED,
  'project-person-update': OFFERED,
  'project-profile-get': OFFERED,
  'project-profile-patch': OFFERED,
  'project-site-set': OFFERED,
  'project-profile-replace': OFFERED,
  'project-record-get': OFFERED,
  'project-reindex': OFFERED,
  'project-rename': OFFERED,
  'project-restore': OFFERED,
  'project-same-address-list': OFFERED,
  'project-status-set': OFFERED,
  'project-summary-generate': OFFERED,
  'project-upload-screening-get': withheld('product-config', 'a project’s upload screening override; how the agent treats uploads, set by a person'),
  'project-upload-screening-set': withheld('product-config', 'a project’s upload screening override; how the agent treats uploads, set by a person'),

  // documents
  'deletion-list': OFFERED,
  'document-archive': OFFERED,
  'document-bin': OFFERED,
  'document-by-name-resolve': OFFERED,
  'document-delete': OFFERED,
  'document-download': OFFERED,
  'document-file-get': OFFERED,
  'document-get': OFFERED,
  'document-list': OFFERED,
  'document-ingest-cancel': OFFERED,
  'document-model-get': OFFERED,
  'document-move': OFFERED,
  'document-name-match': OFFERED,
  'document-preview-get': OFFERED,
  'document-reingest': OFFERED,
  'document-rename': OFFERED,
  'document-restore': OFFERED,
  'document-role-clear': OFFERED,
  'document-role-declare': OFFERED,
  'document-role-list': OFFERED,
  'project-document-findings': OFFERED,
  // Piloti too: the filters (type, facts, references, register order) are what `knowledge_search` cannot ask, and the
  // description says a passage is a pointer to read, not a source to quote.
  'workspace-search': OFFERED,
  'workspace-search-suggest': OFFERED,
  'workspace-search-export': OFFERED,
  'document-status': OFFERED,
  'document-summary-get': OFFERED,
  'document-tags-update': OFFERED,
  'document-text-get': OFFERED,
  'document-thumbnail-get': {
    external: false,
    agent: false,
    withheld: {
      category: 'ui-state',
      reason: 'a link to the file grid’s thumbnail image, which an agent cannot look at; document-look shows a page',
    },
  },
  'document-unarchive': OFFERED,
  'document-upload': OFFERED,
  'document-visual-details-get': OFFERED,
  'hold-create': OFFERED,
  'hold-list': OFFERED,
  'hold-release': SENSITIVE,
  'project-upload-list': OFFERED,
  'quarantine-list': OFFERED,
  'session-document-upload': OFFERED,
  'upload-batch-get': OFFERED,
  'upload-batch-open': OFFERED,
  'upload-batch-seal': OFFERED,
  // saved searches (catalog/saved-searches.ts)
  'saved-search-create': OFFERED,
  'saved-search-delete': OFFERED,
  'saved-search-list': OFFERED,
  'saved-search-update': OFFERED,

  // folders
  'office-shelf-folder-create': OFFERED,
  'office-shelf-folder-delete': OFFERED,
  'office-shelf-folder-ensure': OFFERED,
  'office-shelf-folder-list': OFFERED,
  'office-shelf-folder-update': OFFERED,
  'office-shelf-root-sort-get': OFFERED,
  'office-shelf-root-sort-start': OFFERED,
  'project-folder-access-get': OFFERED,
  'project-folder-access-set': SENSITIVE,
  'project-folder-bin-list': OFFERED,
  'project-folder-bin-purge': OFFERED,
  'project-folder-create': OFFERED,
  'project-folder-delete': OFFERED,
  'project-folder-ensure': OFFERED,
  'project-folder-list': OFFERED,
  'project-folder-restore': OFFERED,
  'project-folder-update': OFFERED,
  'project-root-sort-get': OFFERED,
  'project-root-sort-start': OFFERED,
  'root-sort-run-apply': OFFERED,
  'root-sort-run-cancel': OFFERED,
  'root-sort-run-get': OFFERED,
  'root-sort-run-undo': OFFERED,

  // mail: `exposure-mail.ts`
  ...MAIL_EXPOSURE,
  ...BASE_KNOWLEDGE_EXPOSURE,

  // review
  'annotation-create': { external: true, agent: 'native:canvas__mark', reason: CANVAS },
  'annotation-delete': { external: true, agent: 'native:canvas__delete', reason: CANVAS },
  'annotation-get': OFFERED,
  'annotation-list': OFFERED,
  'annotation-reply-create': { external: true, agent: 'native:canvas__reply', reason: CANVAS },
  'annotation-reply-delete': OFFERED,
  'annotation-reply-update': OFFERED,
  'annotation-update': { external: true, agent: 'native:canvas__update', reason: CANVAS },
  'document-annotations-export': OFFERED,
  'document-quarantine-allow': SENSITIVE,
  'document-quarantine-allow-request': OFFERED,
  'document-quarantine-get': OFFERED,
  'quarantine-decide': SENSITIVE,
  'document-revision-candidates': OFFERED,
  'document-review-list': OFFERED,
  'document-revision-compare': OFFERED,
  'document-revision-link-set': OFFERED,
  'document-thread-ensure': OFFERED,
  'document-version-approve': OFFERED,
  'document-version-content-get': OFFERED,
  'document-version-content-replace': OFFERED,
  'document-version-diff': OFFERED,
  'document-version-fork': OFFERED,
  'document-version-get': OFFERED,
  'document-version-list': OFFERED,
  'document-version-publish': OFFERED,
  'document-version-reject': OFFERED,
  'document-version-request-changes': OFFERED,
  'document-version-reviewer-list': OFFERED,
  'document-version-submit': OFFERED,
  'project-annotation-list': OFFERED,
  'project-annotations-export': OFFERED,

  // conversations
  'answer-feedback-list': OFFERED,
  'answer-feedback-retract': OFFERED,
  'answer-feedback-submit': OFFERED,
  'citation-format': withheld('model-compute', 'formats the sources it is sent as APA, BibTeX or RIS; any agent can do that itself'),
  'conversation-create': OFFERED,
  'conversation-delete': OFFERED,
  'conversation-draft-file': OFFERED,
  'conversation-draft-get': OFFERED,
  'conversation-get': OFFERED,
  'conversation-list': OFFERED,
  'conversation-message-add': OFFERED,
  'conversation-message-changes': OFFERED,
  'conversation-message-export': OFFERED,
  'conversation-message-list': OFFERED,
  'conversation-message-update': OFFERED,
  'conversation-message-usage': withheld('product-config', 'what one of the agent’s answers cost; billing, not office work'),
  'conversation-read-mark': withheld('ui-state', 'what the person has seen; an agent marking it read hides news from them'),
  'conversation-title-generate': withheld('model-compute', 'a model names the conversation; the caller can name it and save it with conversation-update'),
  'conversation-update': OFFERED,
  'feedback-office-report-list': OFFERED,
  'feedback-report-list': OFFERED,
  'feedback-report-submit': OFFERED,
  'feedback-thread-get': OFFERED,
  'feedback-thread-reply': OFFERED,
  'passage-similar-search': OFFERED,
  'agent-ask-cancel': ASK,
  'agent-ask-create': ASK,
  'agent-ask-get': ASK,

  // collaboration
  'assignment-add': OFFERED,
  'assignment-candidate-list': OFFERED,
  'assignment-list': OFFERED,
  'assignment-remove': OFFERED,
  'conversation-awaiting-get': OFFERED,
  'conversation-mention-candidate-list': OFFERED,
  'inbox-item-archive': withheld('ui-state', 'puts a request away from the person, who has not seen it; the same reason mark-read is withheld'),
  'inbox-item-mark-read': withheld('ui-state', 'what the person has seen; an agent marking it read hides news from them'),
  'inbox-item-mark-unread': withheld('ui-state', 'what the person has seen; theirs to mark'),
  'inbox-item-restore': withheld('ui-state', 'the reverse of archive, which an agent cannot do; what the person put away is theirs to bring back'),
  'inbox-list': OFFERED,
  'inbox-summary-get': OFFERED,
  'inbox-unread-anchor-list': withheld('ui-state', 'the unread markers the document viewer draws; screen state'),
  'mention-request-release': OFFERED,
  'agent-change-undo': DECISION,
  'proposal-apply': DECISION,
  'proposal-dismiss': DECISION,
  'proposal-get': OFFERED,
  'proposal-list': OFFERED,
  'push-device-list': withheld('ui-state', 'the person’s own browsers registered for push; device state'),
  'push-device-remove': withheld('ui-state', 'the person’s own browsers registered for push; device state'),
  'push-preference-get': withheld('ui-state', 'which notifications reach the person’s devices; theirs to set'),
  'push-preference-update': withheld('ui-state', 'which notifications reach the person’s devices; theirs to set'),
  'session-document-delete': OFFERED,
  'session-document-list': OFFERED,
  'sharing-candidate-list': OFFERED,
  'sharing-get': OFFERED,
  'sharing-grant-add': SENSITIVE,
  'sharing-grant-revoke': SENSITIVE,
  'sharing-grant-update': SENSITIVE,
  'sharing-visibility-set': SENSITIVE,
  // personal memory (ADR-0180): the person's own notes, acted on as the person
  'personal-memory-clear': OFFERED,
  'personal-memory-create': { external: true, agent: 'native:remember', reason: PERSONAL_MEMORY },
  'personal-memory-delete': OFFERED,
  'personal-memory-list': OFFERED,
  'personal-memory-update': OFFERED,
  'user-preference-get': withheld('ui-state', 'the person’s interface preferences (language, active project); screen state'),
  'user-preference-update': withheld('ui-state', 'the person’s interface preferences (language, active project); screen state'),

  // tasks
  'project-task-run-list': OFFERED,
  'task-create': { external: true, agent: 'native:create_task', reason: TASK },
  'task-delete': OFFERED,
  'task-get': OFFERED,
  'task-list': OFFERED,
  'task-run-cancel': OFFERED,
  'task-run-commission': { external: true, agent: 'native:create_task', reason: TASK },
  'task-run-document-add': OFFERED,
  'task-run-get': OFFERED,
  'task-run-review': OFFERED,
  'task-run-start': OFFERED,
  'task-run-write-now': OFFERED,
  'task-update': OFFERED,

  // skills
  'skill-category-create': OFFERED,
  'skill-category-delete': OFFERED,
  'skill-category-list': OFFERED,
  'skill-category-update': OFFERED,
  'skill-create': OFFERED,
  'skill-curated-set-enabled': withheld('product-config', 'switches one of the agent’s platform-curated skills on or off; product configuration'),
  'skill-delete': OFFERED,
  'skill-get': { external: true, agent: false, reason: SKILL_READ },
  'skill-invocable-list': OFFERED,
  'skill-list': OFFERED,
  'skill-search': { external: true, agent: false, reason: SKILL_READ },
  'skill-review': withheld('model-compute', 'a model critiques a skill draft and stores nothing; the calling agent can review its own draft'),
  'skill-update': OFFERED,

  // knowledge
  'site-resolve': OFFERED,
  'address-search': withheld('external-service', 'proxies a public geocoder; a calling agent has its own map and web tools'),
  'knowledge-base-get': OFFERED,
  'norm-list': OFFERED,
  'knowledge-document-get': OFFERED,
  'widget-token-get': withheld('external-service', 'mints a token for the WorkOS widgets the browser renders; the identity provider’s UI, not office work'),

  // bim
  'bim-check-confirm': OFFERED,
  'bim-check-list': OFFERED,
  'bim-check-withdraw': OFFERED,
  'bim-checks-export': OFFERED,
  'bim-model-get': OFFERED,
  'bim-model-list': OFFERED,
  'bim-model-query': {
    external: true,
    agent: 'native:ifc_query',
    reason: 'The agent counts and reads the model with its own `ifc_query`, which says what the export cannot answer',
  },
  'bim-model-source-get': OFFERED,
  'diagram-file': OFFERED,

  // organization
  'organization-audit-portal-link-create': withheld('external-service', 'a link into the identity provider’s audit-log portal, not the office’s workspace'),
  'organization-budget-get': withheld('product-config', 'spend limits on the agent itself; a refused call says when one stops work'),
  'organization-budget-remove': withheld('product-config', 'spend limits on the agent itself; product configuration'),
  'organization-budget-set': withheld('product-config', 'spend limits on the agent itself; product configuration'),
  'organization-deleted-folder-content-get': withheld('product-config', 'what the agent keeps of a purged folder; a retention policy a person sets'),
  'organization-deleted-folder-content-set': withheld('product-config', 'what the agent keeps of a purged folder; a retention policy a person sets'),
  'organization-download-log-list': OFFERED,
  'organization-download-log-retention-set': withheld('product-config', 'how long the agent keeps the download log; a retention policy a person sets'),
  'office-conventions-decide': OFFERED,
  'office-conventions-list': OFFERED,
  'organization-failed-document-reingest': OFFERED,
  'organization-instructions-get': withheld('product-config', 'the standing instructions shape every answer of the agent; they configure the product, and the agent already reads them'),
  'organization-instructions-set': withheld('product-config', 'the standing instructions shape every answer of the agent; configuring the product is a person’s act'),
  'organization-llm-credential-create': withheld('product-config', 'the LLM provider keys the agent runs on; product configuration and a credential'),
  'organization-llm-credential-list': withheld('product-config', 'the LLM provider keys the agent runs on; product configuration and a credential'),
  'organization-llm-credential-revoke': withheld('product-config', 'the LLM provider keys the agent runs on; product configuration and a credential'),
  'organization-llm-credential-verify': withheld('product-config', 'the LLM provider keys the agent runs on; product configuration and a credential'),
  'organization-llm-provider-mode-set': withheld('product-config', 'whether the agent runs on the platform’s or the office’s provider key; product configuration'),
  'organization-member-list': OFFERED,
  'organization-memory-create': { external: true, agent: 'native:remember', reason: MEMORY },
  'organization-memory-delete': OFFERED,
  'organization-memory-list': OFFERED,
  'organization-memory-update': OFFERED,
  'organization-model-config-get': withheld('product-config', 'which models the agent runs on; product configuration'),
  'organization-model-config-set': withheld('product-config', 'which models the agent runs on; product configuration'),
  'organization-model-config-version-activate': withheld('product-config', 'which models the agent runs on; product configuration'),
  'organization-model-config-version-list': withheld('product-config', 'the history of which models the agent ran on; product configuration'),
  'organization-model-search': withheld('product-config', 'the model catalog the model configuration picks from; product configuration'),
  'organization-role-create': SENSITIVE,
  'organization-role-delete': SENSITIVE,
  'organization-role-list': OFFERED,
  'organization-role-update': SENSITIVE,
  'organization-settings-get': withheld('product-config', 'how the agent works for the office (language, effort and other defaults); a person sets it in Settings'),
  'organization-settings-update': withheld('product-config', 'how the agent works for the office (language, effort and other defaults); a person sets it in Settings'),
  'organization-storage-get': OFFERED,
  'organization-upload-screening-get': withheld('product-config', 'the office’s upload screening policy; how the agent treats uploads, set by a person'),
  'organization-upload-screening-set': withheld('product-config', 'the office’s upload screening policy; how the agent treats uploads, set by a person'),
  'organization-usage-get': withheld('product-config', 'what the office spent on the agent itself, by model and day; billing, not office work'),
  'organization-usage-notice-get': withheld('product-config', 'the budget window close to stopping the person; a refused call says so itself'),
  'organization-web-search-set': withheld('external-service', 'switches the web search provider the agent answers with; a calling agent has its own web search'),
  'organization-zdr-set': withheld('product-config', 'whether model providers may keep data; a product privacy setting a person decides'),
  // What changed in the product (ADR-0156): read-only product news, the same for every office. Offered: an
  // outside agent asked "can it do X now?" and the in-product agent asked "what's new?" both answer from it.
  'release-note-list': OFFERED,
  'release-summary-notice-get': withheld('ui-state', 'whether the person wants the weekly summary notice; their own setting'),
  'release-summary-notice-set': withheld('ui-state', 'whether the person wants the weekly summary notice; theirs to set'),
  'release-summary-seen-mark': withheld('ui-state', 'whether this person has closed the weekly summary notice; their own screen'),
  'release-summary-unseen-get': withheld('ui-state', 'which summary the notice still owes this person; release-note-list reads them'),

  // platform: classified platform-public or tenant content, in `exposure/platform.ts` (ADR-0160)
  ...PLATFORM_EXPOSURE,
  ...PLATFORM_KNOWLEDGE_EXPOSURE,
  ...PLATFORM_SKILL_EXPOSURE,

  // the agent’s read tools (`backend-operations.ts`)
  'knowledge-search': { external: true, agent: 'native:knowledge_search', reason: NATIVE_READ },
  'passage-read': { external: true, agent: 'native:read_file', reason: NATIVE_READ },
  'files-list': { external: true, agent: 'native:list_files', reason: NATIVE_READ },
  'document-look': { external: true, agent: 'native:look', reason: NATIVE_READ },
  'ifc-measure': { external: true, agent: 'native:ifc_measure', reason: NATIVE_READ },
  'dxf-measure': { external: true, agent: 'native:dxf_measure', reason: NATIVE_READ },
  'law-lookup': { external: true, agent: 'native:ris_lookup_tool', reason: NATIVE_READ },

  // the app-only tools of the door's MCP Apps views (`catalog/app-views.ts`)
  'proposal-card-apply': APP_ONLY,
  'proposal-card-dismiss': APP_ONLY,
} as const satisfies Record<OperationName | BackendOperationName | AppToolName, Exposure>

export type ExposedName = keyof typeof EXPOSURE
