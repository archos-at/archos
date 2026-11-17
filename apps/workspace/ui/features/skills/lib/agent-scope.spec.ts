/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { agentScopeLabelKey, formatAgentScope, parseAgentScope } from './agent-scope'

describe('parseAgentScope', () => {
  it('treats an absent key as every agent', () => {
    expect(parseAgentScope(undefined).selected).toEqual([
      'researcher',
      'deep_researcher',
    ])
    expect(parseAgentScope('').selected).toEqual(['researcher', 'deep_researcher'])
  })

  it('reads a restriction, tolerating whitespace', () => {
    expect(parseAgentScope(' deep_researcher , ').selected).toEqual(['deep_researcher'])
  })

  it('reads the retired shallow_researcher name as the researcher', () => {
    const scope = parseAgentScope('shallow_researcher')
    expect(scope.selected).toEqual(['researcher'])
    expect(scope.unknown).toEqual([])

    const both = parseAgentScope('shallow_researcher,deep_researcher')
    expect(both.selected).toEqual(['researcher', 'deep_researcher'])
  })

  it('treats an all-unknown list as every agent, and keeps the unknown names', () => {
    const scope = parseAgentScope('voice-ana, shallow_reseacher')
    expect(scope.selected).toEqual(['researcher', 'deep_researcher'])
    expect(scope.unknown).toEqual(['voice-ana', 'shallow_reseacher'])
  })
})

describe('formatAgentScope', () => {
  it('writes nothing when every agent is selected — the default is the absent key', () => {
    expect(
      formatAgentScope({ selected: ['researcher', 'deep_researcher'], unknown: [] }),
    ).toBe('')
  })

  it('writes the restriction when one agent is deselected', () => {
    expect(formatAgentScope({ selected: ['deep_researcher'], unknown: [] })).toBe('deep_researcher')
  })

  it('carries unknown names through a save it did not change', () => {
    expect(
      formatAgentScope({
        selected: ['researcher', 'deep_researcher'],
        unknown: ['voice-ana'],
      }),
    ).toBe('voice-ana')
  })

  it('round-trips a restriction', () => {
    for (const raw of ['deep_researcher', 'researcher']) {
      expect(formatAgentScope(parseAgentScope(raw))).toBe(raw)
    }
  })
})

describe('agentScopeLabelKey', () => {
  it('is null for the default, so a badge appears only where there is a scope', () => {
    expect(agentScopeLabelKey(undefined)).toBeNull()
    expect(agentScopeLabelKey('researcher,deep_researcher')).toBeNull()
    expect(agentScopeLabelKey('voice-ana')).toBeNull()
  })

  it('names the surviving agent', () => {
    expect(agentScopeLabelKey('researcher')).toBe('chatOnly')
    expect(agentScopeLabelKey('deep_researcher')).toBe('deepOnly')
    expect(agentScopeLabelKey('deep_researcher,voice-ana')).toBe('deepOnly')
    expect(agentScopeLabelKey('shallow_researcher')).toBe('chatOnly')
    expect(agentScopeLabelKey('shallow_researcher,deep_researcher')).toBeNull()
  })
})
