/**
 * The audit registry: every action the app may emit, WITH the WorkOS Audit Log
 * schema that action's events are validated against.
 *
 * ONE list, on purpose. WorkOS rejects an event whose action has no schema in
 * the environment ("event 'resource.shared', version '1' has not been
 * configured in this environment", issues #255/#256), and this list used to
 * exist twice: `AUDIT_ACTIONS` in `service.ts` and a hand-maintained `SCHEMAS`
 * array in `scripts/provision-workos-audit-schemas.mjs`. They drifted by nine
 * actions — the whole `resource.*` sharing family among them — and the only
 * symptom was one ERROR log per privileged mutation, on the side of the
 * emitter that deliberately never throws. Here `AUDIT_ACTIONS` is DERIVED from
 * the keys below, so an action without a schema is unrepresentable rather than
 * merely detectable.
 *
 * Plain ESM rather than TypeScript because both consumers must read this file
 * as-is: `service.ts` through the Next.js bundler, and the provisioning script
 * under bare `node` in the deploy Job (the runtime image ships no TypeScript
 * loader). Importing `service.ts` from the script is doubly impossible — it is
 * `import 'server-only'`.
 *
 * **Metadata values are TYPE NAMES, not examples.** The WorkOS API takes a
 * JSON-Schema-shaped `properties` map and `@workos-inc/node` passes each value
 * straight through as `{ type: <value> }`, so `'Example Org'` registers a
 * property whose type is the string "Example Org". And the KEYS must match
 * what the `recordAuditEvent` call site really sends: a schema with the wrong
 * keys rejects events exactly like a missing one. Every entry below was read
 * off its call site — when you change a `metadata:` object there, change it
 * here in the same commit.
 *
 * **Registering metadata makes it REQUIRED, actor metadata included.** WorkOS
 * generates the validator from what is registered here, and an entry with a
 * `metadata` map yields `required: [action, actor, context, occurred_at,
 * targets, metadata]` AND `actor: {required: [id, type, metadata]}` — the actor
 * clause appearing even though nothing here declares an actor schema. That is
 * why `recordAuditEvent` always sends both keys, `{}` when it has nothing to
 * put in them (issues #274/#277); do not "simplify" either one back to
 * `undefined`. Entries with no `metadata` map at all (`project.restored`) get
 * the permissive generic schema instead, and accept the empty objects too.
 */

import { INBOUND_MAIL_AUDIT_SCHEMAS } from './schemas-inbound-mail.mjs'
import { PLATFORM_KNOWLEDGE_AUDIT_SCHEMAS } from './schemas-platform-knowledge.mjs'
import { LEGACY_AGENT_AUDIT_SCHEMAS } from './schemas-legacy-agent.mjs'
export { AWAITING_EMITTER_AUDIT_ACTIONS } from './schemas-inbound-mail.mjs'

/**
 * @typedef {'string' | 'number' | 'boolean'} AuditMetadataType
 * @typedef {{
 *   readonly targets: readonly { readonly type: string }[],
 *   readonly metadata?: Readonly<Record<string, AuditMetadataType>>,
 * }} AuditSchemaSpec
 */

/**
 * Per-agent-group model ids (`lib/model-config/agent-groups.ts`). Both model
 * surfaces audit the flattened group→model map they just saved, so both carry
 * the same optional keys; `reset`/`rollback` mark the two activate shortcuts
 * that carry no model map at all.
 */
const MODEL_GROUP_METADATA = /** @type {const} */ ({
  intent: 'string',
  clarifier: 'string',
  shallow_research: 'string',
  deep_research: 'string',
  deep_research_router: 'string',
  memory_reflection: 'string',
  ingest_vlm: 'string',
})

/**
 * `created` and `rotated` come off ONE call site
 * (`lib/llm-credentials/service.ts` picks the action by whether `rotatedFrom`
 * is set), so they carry the same metadata by construction.
 */
const LLM_CREDENTIAL_WRITE_METADATA = /** @type {const} */ ({
  provider: 'string',
  secretBackend: 'string', // pragma: allowlist secret (a metadata KEY and its type name, not a credential)
  keyFingerprint: 'string',
  supersededCredentialId: 'string',
  rotatedFrom: 'string',
})

export const AUDIT_SCHEMAS = /** @type {const} */ ({
  'org.created': {
    targets: [{ type: 'organization' }],
    metadata: { name: 'string' },
  },
  'org.settings.updated': {
    targets: [{ type: 'organization' }],
    metadata: { fields: 'string' },
  },
  'org.storage_quota.updated': {
    targets: [{ type: 'organization' }],
    metadata: { quotaBytes: 'number' },
  },
  'org.upload_limit.updated': {
    targets: [{ type: 'organization' }],
    metadata: { maxUploadFileBytes: 'number' },
  },
  'org.documents.reingested': {
    targets: [{ type: 'organization' }],
    metadata: { total: 'number', queued: 'number', skipped: 'number', failed: 'number', truncated: 'boolean' },
  },
  'budget.policy.set': {
    targets: [{ type: 'budget_policy' }],
    metadata: {
      scope: 'string',
      subjectId: 'string',
      unit: 'string',
      dailyLimit: 'number',
      monthlyLimit: 'number',
    },
  },
  'budget.policy.cleared': {
    targets: [{ type: 'budget_policy' }],
    metadata: { scope: 'string', subjectId: 'string' },
  },
  'model_config.version.activated': {
    targets: [{ type: 'model_config_version' }],
    metadata: { ...MODEL_GROUP_METADATA, reset: 'boolean', rollback: 'boolean' },
  },
  'org.role.created': {
    targets: [{ type: 'organization' }],
    metadata: { role: 'string', permissions: 'string' },
  },
  'org.role.updated': {
    targets: [{ type: 'organization' }],
    metadata: { role: 'string', permissions: 'string' },
  },
  'org.role.deleted': {
    targets: [{ type: 'organization' }],
    metadata: { role: 'string', permissions: 'string' },
  },
  'project.folder.access_changed': {
    targets: [{ type: 'project' }],
    metadata: { folderId: 'string', grants: 'string', roles: 'string', documentsMoved: 'number' },
  },
  'project.folder.binned': {
    targets: [{ type: 'project' }],
    metadata: { folderId: 'string', documents: 'number', folders: 'number', purgeAfter: 'string' },
  },
  'project.folder.restored': {
    targets: [{ type: 'project' }],
    metadata: { folderId: 'string', documents: 'number', folders: 'number', restoredTo: 'string' },
  },
  'project.folder.purged': {
    targets: [{ type: 'project' }],
    metadata: { folderId: 'string', documents: 'number', folders: 'number' },
  },
  'org.deleted_folder_content.updated': {
    targets: [{ type: 'organization' }],
    metadata: { policy: 'string' },
  },
  'org.upload_screening.updated': {
    targets: [{ type: 'organization' }],
    metadata: {
      enabled: 'string',
      nameTerms: 'number',
      nameExceptions: 'number',
      contentTerms: 'number',
      detectors: 'string',
    },
  },
  'project.upload_screening.updated': {
    targets: [{ type: 'project' }],
    metadata: { addedNameTerms: 'number', removedNameTerms: 'number' },
  },
  'download_log.viewed': {
    targets: [{ type: 'organization' }],
    metadata: {
      userId: 'string',
      documentId: 'string',
      documentName: 'string',
      nameFiltered: 'boolean',
      kind: 'string',
      from: 'string',
      to: 'string',
      continued: 'boolean',
    },
  },
  'download_log.retention.updated': {
    targets: [{ type: 'organization' }],
    metadata: { days: 'number', previous: 'number' },
  },
  'model_config.zdr.updated': {
    targets: [{ type: 'organization' }],
    metadata: { zdrOnly: 'string' },
  },
  'llm_credential.created': {
    targets: [{ type: 'llm_credential' }],
    metadata: LLM_CREDENTIAL_WRITE_METADATA,
  },
  'llm_credential.rotated': {
    targets: [{ type: 'llm_credential' }],
    metadata: LLM_CREDENTIAL_WRITE_METADATA,
  },
  'llm_credential.revoked': {
    targets: [{ type: 'llm_credential' }],
    metadata: { provider: 'string', keyFingerprint: 'string' },
  },
  'llm_credential.verified': {
    targets: [{ type: 'llm_credential' }],
    metadata: { provider: 'string', modelCount: 'number' },
  },
  'llm_credential.mode_changed': {
    targets: [{ type: 'organization' }],
    metadata: { mode: 'string' },
  },
  'compliance.hold.created': {
    targets: [{ type: 'legal_hold' }],
    metadata: { entityType: 'string', entityId: 'string' },
  },
  'compliance.hold.released': {
    targets: [{ type: 'legal_hold' }],
    metadata: { entityType: 'string', entityId: 'string' },
  },
  'platform.access.break_glass': {
    targets: [{ type: 'platform' }],
    metadata: { activeOrganizationId: 'string' },
  },
  'platform.model_defaults.updated': {
    targets: [{ type: 'platform_model_defaults' }],
    metadata: MODEL_GROUP_METADATA,
  },
  'platform.model_defaults.bootstrapped': {
    targets: [{ type: 'platform_model_defaults' }],
    metadata: MODEL_GROUP_METADATA,
  },
  'platform.reasoning_efforts.updated': {
    targets: [{ type: 'platform_reasoning_efforts' }],
    metadata: MODEL_GROUP_METADATA,
  },
  'platform.lesson.updated': {
    targets: [{ type: 'platform_lesson' }],
    metadata: {
      status: 'string',
      contentChanged: 'boolean',
      rootCauseStatus: 'string',
      reason: 'string',
    },
  },
  'platform.norm_registry.updated': {
    targets: [{ type: 'norm_registry' }],
    metadata: { entries: 'number', version: 'number' },
  },
  'platform.retrieval_settings.updated': {
    targets: [{ type: 'platform_retrieval_settings' }],
    metadata: { settings: 'string', changed: 'number', note: 'string' },
  },
  'platform.pricing.updated': {
    targets: [{ type: 'platform_pricing_version' }],
    metadata: {
      marginMultiplier: 'number',
      usdPerCredit: 'number',
      defaultOrgDailyCredits: 'number',
      defaultOrgMonthlyCredits: 'number',
      supersedesId: 'string',
      note: 'string',
    },
  },
  'project.created': {
    targets: [{ type: 'project' }],
    metadata: { name: 'string' },
  },
  'project.deleted': {
    targets: [{ type: 'project' }],
    metadata: { name: 'string', purgeAfter: 'string' },
  },
  'project.restored': {
    targets: [{ type: 'project' }],
  },
  'project.paused': {
    targets: [{ type: 'project' }],
    metadata: { name: 'string', from: 'string' },
  },
  'project.resumed': {
    targets: [{ type: 'project' }],
    metadata: { name: 'string', from: 'string' },
  },
  'project.closed': {
    targets: [{ type: 'project' }],
    metadata: { name: 'string', from: 'string', outcome: 'string', endedOn: 'string' },
  },
  'project.reopened': {
    targets: [{ type: 'project' }],
    metadata: { name: 'string', from: 'string' },
  },
  'project.period.changed': {
    targets: [{ type: 'project' }],
    metadata: { startedOn: 'string' },
  },
  'project.person.added': {
    targets: [{ type: 'project' }],
    metadata: { personId: 'string' },
  },
  'project.person.updated': {
    targets: [{ type: 'project' }],
    metadata: { personId: 'string' },
  },
  'project.person.deleted': {
    targets: [{ type: 'project' }],
    metadata: { personId: 'string' },
  },
  'project.cleanup.confirmed': {
    targets: [{ type: 'project' }],
    metadata: {
      removed: 'number',
      proposed: 'number',
      removedUnproposed: 'number',
      keptProposed: 'number',
      aiUsed: 'boolean',
      documentIds: 'string',
    },
  },
  'project.role.assigned': {
    targets: [{ type: 'project' }],
    metadata: { organizationMembershipId: 'string', roleSlug: 'string' },
  },
  'project.role.removed': {
    targets: [{ type: 'project' }],
    metadata: { organizationMembershipId: 'string', roleSlug: 'string' },
  },
  'document.uploaded': {
    targets: [{ type: 'document' }],
    metadata: { projectId: 'string', filename: 'string', fileSize: 'number', nameWithheld: 'boolean' },
  },
  'document.screening_overridden': {
    targets: [{ type: 'document' }],
    metadata: { projectId: 'string', filename: 'string', terms: 'string', nameWithheld: 'boolean' },
  },
  'document.quarantined': {
    targets: [{ type: 'document' }],
    metadata: {
      projectId: 'string',
      filename: 'string',
      scope: 'string',
      reasons: 'string',
      reasonsOmitted: 'number',
      checked: 'string',
      uploadedBy: 'string',
      jobId: 'string',
      nameWithheld: 'boolean',
    },
  },
  'document.quarantine_released': {
    targets: [{ type: 'document' }],
    metadata: { projectId: 'string', filename: 'string', reasons: 'string', terms: 'string', nameWithheld: 'boolean' },
  },
  'document.deleted': {
    targets: [{ type: 'document' }],
    metadata: { projectId: 'string', filename: 'string', collectionName: 'string', nameWithheld: 'boolean' },
  },
  'task.created': {
    targets: [{ type: 'task' }],
    metadata: { projectId: 'string', kind: 'string', jobId: 'string', trigger: 'string' },
  },
  'task.completed': {
    targets: [{ type: 'task' }],
    metadata: { projectId: 'string', kind: 'string', status: 'string' },
  },
  'task.reviewed': {
    targets: [{ type: 'task' }],
    metadata: { projectId: 'string', kind: 'string', decision: 'string', withReason: 'boolean' },
  },
  'task.envelope_renewed': {
    targets: [{ type: 'task' }],
    metadata: { projectId: 'string', kind: 'string', trigger: 'string' },
  },
  'document.version.drafted': {
    targets: [{ type: 'document' }],
    metadata: {
      versionId: 'string',
      versionNumber: 'number',
      state: 'string',
      projectId: 'string',
      withComment: 'boolean',
    },
  },
  'document.version.submitted': {
    targets: [{ type: 'document' }],
    metadata: {
      versionId: 'string',
      versionNumber: 'number',
      state: 'string',
      projectId: 'string',
      withComment: 'boolean',
    },
  },
  'document.version.approved': {
    targets: [{ type: 'document' }],
    metadata: {
      versionId: 'string',
      versionNumber: 'number',
      state: 'string',
      projectId: 'string',
      withComment: 'boolean',
    },
  },
  'document.version.changes_requested': {
    targets: [{ type: 'document' }],
    metadata: {
      versionId: 'string',
      versionNumber: 'number',
      state: 'string',
      projectId: 'string',
      withComment: 'boolean',
    },
  },
  'document.version.rejected': {
    targets: [{ type: 'document' }],
    metadata: {
      versionId: 'string',
      versionNumber: 'number',
      state: 'string',
      projectId: 'string',
      withComment: 'boolean',
    },
  },
  'document.version.published': {
    targets: [{ type: 'document' }],
    metadata: {
      versionId: 'string',
      versionNumber: 'number',
      state: 'string',
      projectId: 'string',
      withComment: 'boolean',
    },
  },
  'document.archived': {
    targets: [{ type: 'document' }],
    metadata: { projectId: 'string', filename: 'string', collectionName: 'string', nameWithheld: 'boolean' },
  },
  'document.unarchived': {
    targets: [{ type: 'document' }],
    metadata: { projectId: 'string', filename: 'string', collectionName: 'string', ingest: 'string', nameWithheld: 'boolean' },
  },
  'document.generated': {
    targets: [{ type: 'document' }, { type: 'agent_run' }, { type: 'answer_artifact' }],
    metadata: {
      projectId: 'string',
      producer: 'string',
      filename: 'string',
      fileSize: 'number',
      nameWithheld: 'boolean',
    },
  },
  'document.renamed': {
    targets: [{ type: 'document' }],
    metadata: {
      filename: 'string',
      previousName: 'string',
      displayName: 'string',
      collectionName: 'string',
      nameWithheld: 'boolean',
    },
  },
  'document.revision_changed': {
    targets: [{ type: 'document' }],
    metadata: { olderDocumentId: 'string', linked: 'boolean', collectionName: 'string' },
  },
  'document.annotations.exported': {
    targets: [{ type: 'document' }],
    metadata: {
      format: 'string',
      scope: 'string',
      revision: 'string',
      includeProposals: 'boolean',
      markCount: 'number',
      proposalCount: 'number',
    },
  },
  'project.annotations.exported': {
    targets: [{ type: 'project' }],
    metadata: {
      format: 'string',
      status: 'string',
      assignee: 'string',
      due: 'string',
      documentCount: 'number',
      markCount: 'number',
      proposalCount: 'number',
    },
  },
  'search.plan_list.exported': {
    targets: [{ type: 'organization' }],
    metadata: { format: 'string', scope: 'string', documentCount: 'number', filtered: 'boolean', text: 'boolean' },
  },
  'office_shelf.document.uploaded': {
    targets: [{ type: 'document' }],
    metadata: { filename: 'string', fileSize: 'number', collectionName: 'string' },
  },
  'office_shelf.document.deleted': {
    targets: [{ type: 'document' }],
    metadata: { filename: 'string', collectionName: 'string' },
  },
  'archiv.document.uploaded': {
    targets: [{ type: 'document' }],
    metadata: { filename: 'string', fileSize: 'number', collectionName: 'string' },
  },
  'archiv.document.deleted': {
    targets: [{ type: 'document' }],
    metadata: { filename: 'string', collectionName: 'string' },
  },
  'session.document.uploaded': {
    targets: [{ type: 'document' }],
    metadata: { conversationId: 'string', filename: 'string', fileSize: 'number' },
  },
  'session.document.deleted': {
    targets: [{ type: 'document' }],
    metadata: { conversationId: 'string', filename: 'string', collectionName: 'string' },
  },
  'office_shelf.document.renamed': {
    targets: [{ type: 'document' }],
    metadata: {
      filename: 'string',
      previousName: 'string',
      displayName: 'string',
      collectionName: 'string',
    },
  },
  'archiv.document.renamed': {
    targets: [{ type: 'document' }],
    metadata: {
      filename: 'string',
      previousName: 'string',
      displayName: 'string',
      collectionName: 'string',
    },
  },
  'project.memory.restriction_judged': {
    targets: [{ type: 'project_memory_item' }, { type: 'organization' }],
    metadata: {
      projectId: 'string',
      verdict: 'string',
      outcome: 'string',
      judgedFolders: 'string',
      judgedCount: 'number',
      drawnFolders: 'string',
      drawnCount: 'number',
      restrictedFolders: 'string',
      provenance: 'string',
      conversationId: 'string',
    },
  },
  'resource.shared': {
    targets: [{ type: 'conversation' }],
    metadata: { subject: 'string', role: 'string', visibility: 'string' },
  },
  'resource.share.revoked': {
    targets: [{ type: 'conversation' }],
    metadata: { subject: 'string', self: 'boolean' },
  },
  'resource.share.role_changed': {
    targets: [{ type: 'conversation' }],
    metadata: { subject: 'string', from: 'string', role: 'string' },
  },
  'resource.visibility.changed': {
    targets: [{ type: 'conversation' }],
    metadata: { from: 'string', to: 'string' },
  },
  'resource.ownership.escalated': {
    targets: [{ type: 'conversation' }],
    metadata: { previousRole: 'string', via: 'string' },
  },
  'agent.wake.suppressed': {
    targets: [{ type: 'document_annotation' }],
    metadata: { documentId: 'string', trigger: 'string', status: 'string', reason: 'string', stage: 'string' },
  },
  'agent.change.applied': {
    targets: [{ type: 'document_annotation' }, { type: 'document' }, { type: 'project' }, { type: 'conversation' }],
    metadata: {
      op: 'string',
      markNumber: 'number',
      markKind: 'string',
      status: 'string',
      fields: 'string',
      messageId: 'string',
      changeId: 'string',
    },
  },
  'agent.change.undone': {
    targets: [{ type: 'document_annotation' }, { type: 'document' }, { type: 'conversation' }],
    metadata: {
      op: 'string',
      inverse: 'string',
      markNumber: 'number',
      onBehalfOf: 'string',
      messageId: 'string',
      changeId: 'string',
    },
  },
  'agent.operation.decided': {
    targets: [{ type: 'organization' }, { type: 'project' }, { type: 'document' }],
    metadata: { operation: 'string', decision: 'string', decisionSource: 'string', clientId: 'string' },
  },
  'agent.proposal.created': {
    targets: [{ type: 'proposed_change' }, { type: 'project' }, { type: 'conversation' }],
    metadata: { kind: 'string', operation: 'string', items: 'number', memoryScope: 'string', messageId: 'string' },
  },
  'agent.proposal.decided': {
    targets: [{ type: 'proposed_change' }, { type: 'project' }, { type: 'conversation' }],
    metadata: {
      kind: 'string',
      decision: 'string',
      operation: 'string',
      items: 'number',
      appliedItems: 'number',
      memoryScope: 'string',
      onBehalfOf: 'string',
      messageId: 'string',
    },
  },
  'agent.mark.decided': {
    targets: [{ type: 'document_annotation' }, { type: 'document' }, { type: 'project' }],
    metadata: { decision: 'string', markNumber: 'number', markKind: 'string', onBehalfOf: 'string' },
  },
  'agent.wake.started': {
    targets: [{ type: 'document_annotation' }, { type: 'document' }, { type: 'project' }, { type: 'conversation' }],
    metadata: { trigger: 'string', wakeId: 'string', markNumber: 'number', waits: 'number' },
  },
  'agent.wake.ended': {
    targets: [{ type: 'document_annotation' }, { type: 'document' }, { type: 'project' }, { type: 'conversation' }],
    metadata: {
      trigger: 'string',
      wakeId: 'string',
      outcome: 'string',
      turnOutcome: 'string',
      reason: 'string',
      reasonKind: 'string',
      handedBack: 'boolean',
      markNumber: 'number',
    },
  },
  'agent.wake.stopped': {
    targets: [{ type: 'document_annotation' }, { type: 'document' }, { type: 'project' }, { type: 'conversation' }],
    metadata: { trigger: 'string', wakeId: 'string', wakeStatus: 'string', wokenBy: 'string', by: 'string' },
  },
  'resource.assigned': {
    targets: [{ type: 'document' }],
    metadata: { subjectUserId: 'string' },
  },
  'resource.unassigned': {
    targets: [{ type: 'document' }],
    metadata: { subjectUserId: 'string' },
  },
  ...INBOUND_MAIL_AUDIT_SCHEMAS, ...PLATFORM_KNOWLEDGE_AUDIT_SCHEMAS, ...LEGACY_AGENT_AUDIT_SCHEMAS,
})

/** @typedef {keyof typeof AUDIT_SCHEMAS} AuditAction */

/**
 * Actions kept only so history reads: their schemas stay registered and their
 * labels resolve, but nothing writes them. `schemas.spec.ts` holds both halves:
 * no call site emits one, and none counts as an orphan. Remove an entry once no
 * event under the old name is left in the retention window.
 */
export const RETIRED_AUDIT_ACTIONS = /** @type {const} */ ([
  'archiv.document.uploaded',
  'archiv.document.deleted',
  'archiv.document.renamed', 'platform.norm_registry.updated', // the registry takes no edits since ADR-0175
])

/**
 * Every action the app may emit — derived, never hand-maintained. `tsc` already
 * confines each `recordAuditEvent` call site to this union, so the compiler now
 * carries the guarantee end-to-end: call site → action → registered schema.
 */
export const AUDIT_ACTIONS = /** @type {AuditAction[]} */ (Object.keys(AUDIT_SCHEMAS))
