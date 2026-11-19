/**
 * The audit schemas of the E-Mail-Eingang and its Verläufe (ADR-0137), spread
 * into `AUDIT_SCHEMAS` (`./schemas.mjs`, whose header holds the rules every
 * entry follows). Plain ESM for the same reason: the provisioning script reads
 * it under bare `node` in the deploy Job, so the image copies it beside
 * `schemas.mjs`.
 */

export const INBOUND_MAIL_AUDIT_SCHEMAS = /** @type {const} */ ({
  'inbound_mail.received': {
    targets: [{ type: 'inbound_mail' }, { type: 'project' }],
    metadata: {
      projectId: 'string',
      senderTrust: 'string',
      senderReason: 'string',
      senderFlags: 'string',
      senderClass: 'string',
      automatic: 'boolean',
      dropped: 'string',
      attachments: 'number',
      notStaged: 'number',
      riskFlags: 'string',
      rawScan: 'string',
      unreadable: 'boolean',
      threadMatches: 'number',
      followQueued: 'boolean',
    },
  },
  'inbound_mail.expired': {
    targets: [{ type: 'inbound_mail' }, { type: 'project' }],
    metadata: { projectId: 'string', parts: 'number' },
  },
  'inbound_mail.part_read': {
    targets: [{ type: 'inbound_mail' }, { type: 'project' }],
    metadata: { projectId: 'string', partId: 'string', scan: 'string' },
  },
  'inbound_mail.original_read': {
    targets: [{ type: 'inbound_mail' }, { type: 'project' }],
    metadata: { projectId: 'string', scan: 'string' },
  },
  'inbound_mail.decided': {
    targets: [{ type: 'inbound_mail' }, { type: 'project' }],
    metadata: {
      projectId: 'string',
      decisionId: 'string',
      partId: 'string',
      partKind: 'string',
      action: 'string',
      via: 'string',
      threadAction: 'string',
      mailThreadId: 'string',
      documentType: 'string',
      targetDocumentId: 'string',
      followId: 'string',
      proposalId: 'string',
      screeningRelease: 'boolean',
      acknowledgedSender: 'boolean',
      acknowledgedRisk: 'boolean',
    },
  },
  'inbound_mail.reported': {
    targets: [{ type: 'inbound_mail' }, { type: 'project' }],
    metadata: { projectId: 'string', basis: 'string', managersWarned: 'number', claimedTold: 'number', own: 'boolean' },
  },
  'inbound_mail_address.created': {
    targets: [{ type: 'inbound_mail_address' }, { type: 'project' }],
    metadata: { projectId: 'string' },
  },
  'inbound_mail_address.rotated': {
    targets: [{ type: 'inbound_mail_address' }, { type: 'project' }],
    metadata: { projectId: 'string', previousAddressId: 'string', followsEnded: 'number' },
  },
  'inbound_mail_address.deleted': {
    targets: [{ type: 'inbound_mail_address' }, { type: 'project' }],
    metadata: { projectId: 'string' },
  },
  'inbound_mail_address.forwards_changed': {
    targets: [{ type: 'inbound_mail_address' }, { type: 'project' }],
    metadata: { projectId: 'string', forwards: 'number' },
  },
  'mail_thread.follow_started': {
    targets: [{ type: 'mail_thread' }, { type: 'project' }],
    metadata: { projectId: 'string', followId: 'string', days: 'number', renewed: 'boolean' },
  },
  'mail_thread.follow_ended': {
    targets: [{ type: 'mail_thread' }, { type: 'project' }],
    metadata: { projectId: 'string', followId: 'string', reason: 'string', followerUserId: 'string' },
  },
  'mail_thread.entry_detached': {
    targets: [{ type: 'mail_thread_entry' }, { type: 'mail_thread' }, { type: 'project' }],
    metadata: { projectId: 'string', fromThreadId: 'string', toThreadId: 'string', threadAction: 'string' },
  },
  'mail_thread.original_read': {
    targets: [{ type: 'mail_thread_entry' }, { type: 'mail_thread' }, { type: 'project' }],
    metadata: { projectId: 'string', scan: 'string' },
  },
})

/**
 * Actions registered ahead of their emitter, while the change that adds them is
 * assembled from several work packages (PR-D of ADR-0137: the schemas land
 * first, so every package emits against one registry). `schemas.spec.ts` holds
 * both halves: none of them counts as an orphan, and an action that HAS an
 * emitter fails until it is taken off this list, so the list only shrinks. It
 * must be empty before the change merges (the integrator's checklist).
 */
export const AWAITING_EMITTER_AUDIT_ACTIONS = /** @type {const} */ ([])
