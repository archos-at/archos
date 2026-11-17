// @disk-inputs: AGENTS.md
/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nextConfig } from '../next.config'

describe("Next's agent-file generator", () => {
  it('is switched off', () => {
    expect(nextConfig.agentRules).toBe(false)
  })

  it('has no managed block left in AGENTS.md to rewrite', () => {
    const agents = readFileSync(join(__dirname, '..', 'AGENTS.md'), 'utf8')
    expect(agents).not.toContain('nextjs-agent-rules')
    expect(agents).toContain('node_modules/next/dist/docs/')
  })
})
