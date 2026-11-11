import { describe, expect, it } from 'vitest'
import type { CallToolResult } from '@modelcontextprotocol/server'
import { AI_COMPOSITE_META, AI_GENERATED_META, withAiGeneratedMeta } from './ai-generated-meta'
import { AGENT_OPERATIONS } from './catalog'

const shaped: CallToolResult = { content: [{ type: 'text', text: '{}' }] }
const operation = (name: string) => {
  const op = AGENT_OPERATIONS.find((candidate) => candidate.name === name)
  if (!op) throw new Error(`no operation ${name}`)
  return op
}

/**
 * Art. 50(2) AI Act on the door: every operation whose answer carries a
 * model's text marks it in `_meta`, and the same operation with no such text
 * in its answer (the control) is not marked.
 */
describe('the AI mark on a door result', () => {
  it('marks a written project summary, and not an empty one', () => {
    const op = operation('project-summary-generate')
    expect(withAiGeneratedMeta(op, { summary: 'Wohnhaus, fünf Geschoße.' }, shaped)._meta).toEqual(AI_GENERATED_META)
    expect(withAiGeneratedMeta(op, { summary: '', error: 'backend_error' }, shaped)._meta).toBeUndefined()
  })

  it('marks a page of messages composite when it mixes a person’s and the assistant’s, whole when only the assistant’s', () => {
    const op = operation('conversation-message-list')
    const person = { id: 'm1', role: 'user', content: 'Wie hoch darf die Attika sein?' }
    const assistant = { id: 'm2', role: 'assistant', content: 'Höchstens 1,20 m.' }
    expect(withAiGeneratedMeta(op, { messages: [person, assistant] }, shaped)._meta).toEqual(AI_COMPOSITE_META)
    expect(withAiGeneratedMeta(op, { messages: [assistant] }, shaped)._meta).toEqual(AI_GENERATED_META)
    expect(withAiGeneratedMeta(op, { messages: [person] }, shaped)._meta).toBeUndefined()
  })

  it('marks an ask’s answer, and not an ask still working', () => {
    for (const name of ['agent-ask-create', 'agent-ask-get']) {
      expect(withAiGeneratedMeta(operation(name), { answer: { text: 'x' } }, shaped)._meta).toEqual(AI_GENERATED_META)
      expect(withAiGeneratedMeta(operation(name), { state: 'working', answer: null }, shaped)._meta).toBeUndefined()
    }
  })

  it('never marks a refusal, and keeps what _meta already held', () => {
    const op = operation('agent-ask-get')
    expect(withAiGeneratedMeta(op, { answer: { text: 'x' } }, { ...shaped, isError: true })._meta).toBeUndefined()
    const kept = withAiGeneratedMeta(op, { answer: { text: 'x' } }, { ...shaped, _meta: { other: 1 } })
    expect(kept._meta).toEqual({ other: 1, ...AI_GENERATED_META })
  })
})
