/**
 * @vitest-environment node
 *
 * The agent's filing operations carry the conversation they come from, set by
 * the server, so the filing guard (restricted folders, Meine Ablage) runs on
 * apply as it does for a person's own filing.
 */
import { describe, expect, it } from 'vitest'


import { withConversationOrigin } from './operation-origin'

describe('withConversationOrigin', () => {
  it('stamps the turn’s conversation into a diagram filing, over any id the agent named', () => {
    const input = { params: { id: 'p1' }, body: { title: 'Schnitt', conversationId: 's_other' } }
    expect(withConversationOrigin({ name: 'diagram-file' }, input, 's_turn').body).toEqual({ title: 'Schnitt', conversationId: 's_turn' })
  })

  it('stamps it into an upload’s form fields, keeping the others', () => {
    const input = { body: { files: [], fields: { projectId: 'p1', originConversationId: 's_other' } } }
    expect(withConversationOrigin({ name: 'document-upload' }, input, 's_turn').body).toEqual({
      files: [],
      fields: { projectId: 'p1', originConversationId: 's_turn' },
    })
  })

  it('leaves other operations, and a caller without a conversation, as they are', () => {
    const input = { body: { title: 'x' } }
    expect(withConversationOrigin({ name: 'project-get' }, input, 's_turn')).toBe(input)
    expect(withConversationOrigin({ name: 'diagram-file' }, input, null)).toBe(input)
  })
})
