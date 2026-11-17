/**
 * The audit schemas of the platform's base knowledge (ADR-0165), spread into
 * `AUDIT_SCHEMAS` (`./schemas.mjs`, whose header holds the rules every entry
 * follows). Plain ESM for the same reason: the provisioning script reads it
 * under bare `node` in the deploy Job, and the image copies `schemas*.mjs`.
 */

export const PLATFORM_KNOWLEDGE_AUDIT_SCHEMAS = /** @type {const} */ ({
  'platform.knowledge.change_request_approved': {
    targets: [{ type: 'knowledge_change_request' }],
    metadata: { role: 'string', decisionSource: 'string', awaiting: 'string' },
  },
  'platform.knowledge.change_request_rejected': {
    targets: [{ type: 'knowledge_change_request' }],
    metadata: { role: 'string', decisionSource: 'string', awaiting: 'string', withdrawn: 'number' },
  },
  'platform.knowledge.change_request_approved_alone': {
    targets: [{ type: 'knowledge_change_request' }],
    metadata: { role: 'string', decisionSource: 'string', reason: 'string', revisions: 'string', revisionCount: 'number', awaiting: 'string' },
  },
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
