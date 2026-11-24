// drop after release 2026-W51
export const LEGACY_AGENT_AUDIT_SCHEMAS = /** @type {const} */ ({
  'piloti.wake.suppressed': {
    targets: [{ type: 'document_annotation' }],
    metadata: { documentId: 'string', trigger: 'string', status: 'string', reason: 'string', stage: 'string' },
  },
  'piloti.change.applied': {
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
  'piloti.change.undone': {
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
  'piloti.proposal.created': {
    targets: [{ type: 'proposed_change' }, { type: 'project' }, { type: 'conversation' }],
    metadata: { kind: 'string', operation: 'string', items: 'number', memoryScope: 'string', messageId: 'string' },
  },
  'piloti.proposal.decided': {
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
  'piloti.mark.decided': {
    targets: [{ type: 'document_annotation' }, { type: 'document' }, { type: 'project' }],
    metadata: { decision: 'string', markNumber: 'number', markKind: 'string', onBehalfOf: 'string' },
  },
  'piloti.wake.started': {
    targets: [{ type: 'document_annotation' }, { type: 'document' }, { type: 'project' }, { type: 'conversation' }],
    metadata: { trigger: 'string', wakeId: 'string', markNumber: 'number', waits: 'number' },
  },
  'piloti.wake.ended': {
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
  'piloti.wake.stopped': {
    targets: [{ type: 'document_annotation' }, { type: 'document' }, { type: 'project' }, { type: 'conversation' }],
    metadata: { trigger: 'string', wakeId: 'string', wakeStatus: 'string', wokenBy: 'string', by: 'string' },
  },
})
