/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import { agentDocumentFilename, isNamespacedAgentDocument } from './agent-namespace'

describe('agentDocumentFilename', () => {
  it('files under generated/, with the document id between the prefix and the name', () => {
    expect(agentDocumentFilename('doc_1', 'aktenvermerk-2026-09-01.md')).toBe(
      'generated/doc_1/aktenvermerk-2026-09-01.md',
    )
  })

  it('keeps two documents apart when the model writes one title twice', () => {
    const first = agentDocumentFilename('doc_1', 'aktenvermerk-2026-09-01.md')
    const second = agentDocumentFilename('doc_2', 'aktenvermerk-2026-09-01.md')
    expect(first).not.toBe(second)
  })
})

describe('isNamespacedAgentDocument', () => {
  it('is the agent_document producer, and only that producer', () => {
    expect(isNamespacedAgentDocument({ authoredByProducer: 'agent_document' })).toBe(true)
    for (const authoredByProducer of ['deep_research', 'diagram_svg', 'diagram_pdf', null]) {
      expect(isNamespacedAgentDocument({ authoredByProducer }), String(authoredByProducer)).toBe(false)
    }
  })
})
