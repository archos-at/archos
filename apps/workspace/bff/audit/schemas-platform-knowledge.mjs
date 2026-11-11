/**
 * The audit schemas of the platform's base knowledge (ADR-0165), spread into
 * `AUDIT_SCHEMAS` (`./schemas.mjs`, whose header holds the rules every entry
 * follows). Plain ESM for the same reason: the provisioning script reads it
 * under bare `node` in the deploy Job, and the image copies `schemas*.mjs`.
 */

export const PLATFORM_KNOWLEDGE_AUDIT_SCHEMAS = /** @type {const} */ ({
  // Each a person's own yes on what
  // offices read, in the platform org's trail; entitlements and a home move in
  // the office's own.
  // `awaiting`: the roles the request still needs a yes in, comma-separated; empty once it is approved (ADR-0174).
  'platform.knowledge.change_request_approved': {
    targets: [{ type: 'knowledge_change_request' }],
    metadata: { role: 'string', decisionSource: 'string', awaiting: 'string' },
  },
  // `withdrawn`: previews a disputed request withdrew when it was rejected (ADR-0176), else 0.
  'platform.knowledge.change_request_rejected': {
    targets: [{ type: 'knowledge_change_request' }],
    metadata: { role: 'string', decisionSource: 'string', awaiting: 'string', withdrawn: 'number' },
  },
  // An author's own approval through the override (ADR-0176): the reason they gave, the
  // revisions approved alone (ids, comma-separated, cut at 500 characters; `revisionCount`
  // says when) and the roles still awaited. One event per override, instead of `_approved`.
  'platform.knowledge.change_request_approved_alone': {
    targets: [{ type: 'knowledge_change_request' }],
    metadata: { role: 'string', decisionSource: 'string', reason: 'string', revisions: 'string', revisionCount: 'number', awaiting: 'string' },
  },
  // Every claim without a verdict accepted in one decision: how many, on how many records, the
  // claims left as they were, and whether the person said they checked the sources.
  'platform.knowledge.claims_accepted': {
    targets: [{ type: 'knowledge_change_request' }],
    metadata: { accepted: 'number', records: 'number', alreadyDecided: 'number', sourceChecked: 'boolean', decisionSource: 'string' },
  },
  // Another person's deferred review of a request approved alone, one event per role approved
  // alone: confirmed, or disputed (reject or rollback stays the next person's decision).
  // `status` is the request's when they gave it; `state` its review after (due while another role is owed).
  'platform.knowledge.second_review_confirmed': {
    targets: [{ type: 'knowledge_change_request' }],
    metadata: { role: 'string', decisionSource: 'string', status: 'string', state: 'string' },
  },
  'platform.knowledge.second_review_disputed': {
    targets: [{ type: 'knowledge_change_request' }],
    metadata: { role: 'string', decisionSource: 'string', status: 'string', state: 'string' },
  },
  'platform.knowledge.published': {
    targets: [{ type: 'knowledge_change_request' }],
    metadata: { channel: 'string', moved: 'number', decisionSource: 'string', indexFailed: 'number' },
  },
  'platform.knowledge.rolled_back': {
    targets: [{ type: 'knowledge_change_request' }],
    metadata: { restored: 'number', decisionSource: 'string', deindexed: 'number', deindexFailed: 'number' },
  },
  // A public source's key (ADR-0174): who set it and how they said yes; never the key.
  'platform.knowledge.source_credential_set': {
    targets: [{ type: 'knowledge_source' }],
    metadata: { decisionSource: 'string' },
  },
  'platform.organization.country_entitled': {
    targets: [{ type: 'organization' }],
    metadata: { countryId: 'string', changed: 'boolean', decisionSource: 'string' },
  },
  'platform.organization.country_withdrawn': {
    targets: [{ type: 'organization' }],
    metadata: { countryId: 'string', changed: 'boolean', decisionSource: 'string' },
  },
  'platform.organization.home_country_set': {
    targets: [{ type: 'organization' }],
    metadata: { homeCountry: 'string', previous: 'string', decisionSource: 'string' },
  },
})
