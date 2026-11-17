/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { BACKEND_OPERATIONS } from './backend-operations'
import { AGENT_OPERATIONS } from './catalog'
import { type Audience, isExposedTo } from './exposure'

const ALL = [...AGENT_OPERATIONS, ...BACKEND_OPERATIONS]
const NAMES = new Set(ALL.map((op) => op.name))
const AUDIENCES: readonly Audience[] = ['external', 'agent']

function brokenReferences(): string[] {
  const broken = new Set<string>()
  for (const audience of AUDIENCES) {
    for (const op of ALL) {
      if (!isExposedTo(audience, op.name)) continue
      for (const word of op.description.match(/[a-z][a-z0-9]*(?:-[a-z0-9]+)+/g) ?? []) {
        if (word === op.name || !NAMES.has(word)) continue
        if (!isExposedTo(audience, word)) broken.add(`${audience}: ${op.name} → ${word}`)
      }
    }
  }
  return [...broken].sort()
}

const BASELINE: readonly string[] = [
  'agent: bim-model-get → bim-model-query',
  'agent: bim-model-list → bim-model-query',
  'agent: bim-model-source-get → bim-model-query',
  'agent: project-folder-access-get → project-folder-access-set',
  'agent: skill-list → task-create',
]

describe('descriptions name only operations the door offers', () => {
  it('has no reference beyond the baseline, and the baseline holds no fixed one', () => {
    expect(brokenReferences()).toEqual([...BASELINE].sort())
  })
})
