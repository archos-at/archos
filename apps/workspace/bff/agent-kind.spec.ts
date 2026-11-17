import { describe, expect, it } from 'vitest'
import { AGENT_KIND, AGENT_KINDS, isAgentKind } from './agent-kind'
import { LEGACY_AGENT_KIND } from './legacy-agent-kind'

describe('the agent actor kind', () => {
  it('reads the new value and the old one alike', () => {
    expect(isAgentKind(AGENT_KIND)).toBe(true)
    expect(isAgentKind(LEGACY_AGENT_KIND)).toBe(true)
  })

  it('is false for a person and for anything else', () => {
    expect(isAgentKind('person')).toBe(false)
    expect(isAgentKind('')).toBe(false)
    expect(isAgentKind(null)).toBe(false)
    expect(isAgentKind(undefined)).toBe(false)
  })

  it('lists both values', () => {
    expect(AGENT_KINDS).toEqual([AGENT_KIND, LEGACY_AGENT_KIND])
  })
})
