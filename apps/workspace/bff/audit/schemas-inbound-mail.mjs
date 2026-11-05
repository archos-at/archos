/**
 * The audit schemas of the E-Mail-Eingang and its Verläufe (ADR-0137), spread
 * into `AUDIT_SCHEMAS` (`./schemas.mjs`, whose header holds the rules every
 * entry follows). Plain ESM for the same reason: the provisioning script reads
 * it under bare `node` in the deploy Job, so the image copies it beside
 * `schemas.mjs`.
 */

export const INBOUND_MAIL_AUDIT_SCHEMAS = /** @type {const} */ ({
  // --- The E-Mail-Eingang (ADR-0137) -----------------------------------------
  // Mail a stranger may write. Every key below is an id, a code, a count or a
  // flag, never a sender, a subject, a file name, an address or a token: the
  // trail outlives the scrub of a settled mail (migration 0196), and the PII
  // canary (`receive-job.spec.ts`) feeds distinctive values through the receive
  // path and asserts none reaches this metadata. Codes are the vocabularies'
  // own tokens (`inbound-mail-vocabulary.ts`); a list is comma-joined.
  //
  // A mail reached its project's E-Mail-Eingang (or was dropped as automatic
  // mail: then only `dropped` is set). Actor `system:inbound_mail`: the receive
  // job decides nothing a person would, it labels and holds. `senderFlags` and
  // `riskFlags` are comma-joined codes; `rawScan` is the whole message's scan.
  'inbound_mail.received': {
    targets: [{ type: 'inbound_mail' }, { type: 'project' }],
    metadata: {
      projectId: 'string',
      senderTrust: 'string',
      senderReason: 'string',
      senderFlags: 'string',
      // Who the sender is to the project (migration 0197): `verified_writer` is filed as them.
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
  // Nobody decided within the window (sweep 3): its parts are `expired`,
  // restorable for seven days. Actor `system:inbound_mail`.
  'inbound_mail.expired': {
    targets: [{ type: 'inbound_mail' }, { type: 'project' }],
    metadata: { projectId: 'string', parts: 'number' },
  },
  // A person read the bytes of a held attachment (`inbound-mail-part-content-get`).
  'inbound_mail.part_read': {
    targets: [{ type: 'inbound_mail' }, { type: 'project' }],
    metadata: { projectId: 'string', partId: 'string', scan: 'string' },
  },
  // A person downloaded a held mail's original `.eml` (`inbound-mail-original-get`),
  // scanned whole on the request; `scan` is that scan's status.
  'inbound_mail.original_read': {
    targets: [{ type: 'inbound_mail' }, { type: 'project' }],
    metadata: { projectId: 'string', scan: 'string' },
  },
  // One decision row (`inbound_mail_decisions`), sent at least once from the
  // table under an idempotency key (sweep 11 drains `audited_at IS NULL`), with
  // the time of the decision. Actor: the person who decided; `via` says whether
  // in the app, as an outside agent, through an agent's card or as their follow.
  // The acknowledgements are what the person explicitly accepted.
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
  // A project got its address, a new one replaced it (the old one stops at
  // once and every follow on the project ends, `followsEnded`), or the project
  // stopped taking mail. Actor: the project manager who did it.
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
  // A person's standing decision to append a thread's later verified replies
  // as themselves (D31): started or renewed for `days`, and ended with its
  // reason (`MAIL_THREAD_FOLLOW_END_REASONS`); `followerUserId` names whose
  // follow ended when a manager or the system ended it.
  'mail_thread.follow_started': {
    targets: [{ type: 'mail_thread' }, { type: 'project' }],
    metadata: { projectId: 'string', followId: 'string', days: 'number', renewed: 'boolean' },
  },
  'mail_thread.follow_ended': {
    targets: [{ type: 'mail_thread' }, { type: 'project' }],
    metadata: { projectId: 'string', followId: 'string', reason: 'string', followerUserId: 'string' },
  },
  // A filed message moved out of its thread into another or a new one (D34).
  'mail_thread.entry_detached': {
    targets: [{ type: 'mail_thread_entry' }, { type: 'mail_thread' }, { type: 'project' }],
    metadata: { projectId: 'string', fromThreadId: 'string', toThreadId: 'string', threadAction: 'string' },
  },
  // A reader of the thread downloaded a filed message's original `.eml`,
  // scanned whole on the request; `scan` is that scan's status.
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
