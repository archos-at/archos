// The audit schemas of the per-office quotas a platform operator sets (storage, the largest
// file, the monthly ingest allowance of ADR-0199), spread into `AUDIT_SCHEMAS`
// (`./schemas.mjs`, whose header holds the rules every entry follows).

export const ORG_QUOTA_AUDIT_SCHEMAS = /** @type {const} */ ({
  'org.storage_quota.updated': {
    targets: [{ type: 'organization' }],
    metadata: { quotaBytes: 'number' },
  },
  'org.upload_limit.updated': {
    targets: [{ type: 'organization' }],
    metadata: { maxUploadFileBytes: 'number' },
  },
  'org.ingest_allowance.updated': {
    targets: [{ type: 'organization' }],
    metadata: { unit: 'string', monthlyAllowance: 'number', explicit: 'boolean' },
  },
})
