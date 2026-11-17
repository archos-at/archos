/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import {
  AGENT_DOCUMENT_NAMESPACE,
  agentDocumentFilename,
  isAgentDocumentFilename,
} from './agent-namespace'

describe('agentDocumentFilename', () => {
  it('puts the document id between the prefix and the name', () => {
    expect(agentDocumentFilename('doc_1', 'aktenvermerk-2026-09-01.md')).toBe(
      'piloti/doc_1/aktenvermerk-2026-09-01.md',
    )
  })

  it('keeps two documents apart when the model writes one title twice', () => {
    const first = agentDocumentFilename('doc_1', 'aktenvermerk-2026-09-01.md')
    const second = agentDocumentFilename('doc_2', 'aktenvermerk-2026-09-01.md')
    expect(first).not.toBe(second)
  })

  it('produces a name the SQL predicate matches', () => {
    expect(agentDocumentFilename('doc_1', 'x.md').startsWith('piloti/')).toBe(true)
    expect(AGENT_DOCUMENT_NAMESPACE).toBe('piloti/')
  })
})

describe('isAgentDocumentFilename', () => {
  it('accepts what the builder produces', () => {
    expect(isAgentDocumentFilename(agentDocumentFilename('doc_1', 'a.md'))).toBe(true)
  })

  it('rejects a name that merely mentions the namespace', () => {
    for (const name of ['piloti-bericht.md', 'x/piloti/doc_1/a.md', 'Piloti/doc_1/a.md', 'apiloti/a.md']) {
      expect(isAgentDocumentFilename(name), name).toBe(false)
    }
  })

  it('rejects the names a person’s upload actually carries', () => {
    for (const name of ['plan.pdf', 'Brandschutz Gutachten.docx', 'aktenvermerk-2026-09-01.md']) {
      expect(isAgentDocumentFilename(name), name).toBe(false)
    }
  })
})
