// The agent's old actor kind, still written by the database and the BFF for one release: drop after release 2026-W51.
import { describe, expect, it } from 'vitest'
import { LEGACY_AGENT_KIND } from './legacy-agent-kind'

describe('the old agent actor kind', () => {
  it('is the value the database and the BFF still write', () => {
    expect(LEGACY_AGENT_KIND).toBe('piloti')
  })
})
