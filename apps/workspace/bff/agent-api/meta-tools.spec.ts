// @disk-inputs: ../../packages/agent/src/agent/tools/workspace/meta_tools.json
/**
 * @vitest-environment node
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { metaToolsFor } from './discovery'
import { AGENT_DOMAINS } from './operation'

const FIXTURE = resolve(__dirname, '../../../../packages/agent/src/agent/tools/workspace/meta_tools.json')

describe('the meta-tools the in-product agent reads', () => {
  it('are the committed fixture', () => {
    const generated =
      JSON.stringify(
        {
          comment:
            'Written by apps/workspace/bff/agent-api/meta-tools.spec.ts from metaToolsFor (discovery.ts), the in-product variant. Read by tools/workspace/register.py. Regenerate with UPDATE_FIXTURES=1.',
          tools: metaToolsFor({ actor: 'piloti' }),
        },
        null,
        2,
      ) + '\n'
    if (process.env.UPDATE_FIXTURES === '1') writeFileSync(FIXTURE, generated, 'utf8')
    expect(readFileSync(FIXTURE, 'utf8'), 'The meta-tools changed. Re-run with UPDATE_FIXTURES=1 and commit the fixture.').toBe(generated)
  })

  it('offer every caller the office door’s domains, never the operator console', () => {
    const domainsOf = (actor: 'piloti' | 'external_agent') =>
      (metaToolsFor({ actor })['search-operations'].inputSchema as { properties: { domain: { enum: string[] } } }).properties.domain.enum
    for (const actor of ['piloti', 'external_agent'] as const) {
      expect(domainsOf(actor)).toEqual(AGENT_DOMAINS.filter((domain) => domain !== 'platform'))
    }
  })

  it('never claim a search the code does not do', () => {
    const words = JSON.stringify(metaToolsFor({ actor: 'external_agent' }))
    expect(words).not.toMatch(/regular expression|regex/i)
  })
})
