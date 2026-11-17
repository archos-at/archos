/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { AGENT_OPERATIONS } from './catalog'
import { inputSchemaOf } from './discovery'
import { resolvePath, validateOperationInput } from './dispatch'

const withExamples = AGENT_OPERATIONS.filter((op) => op.examples && op.examples.length > 0)

describe('operation examples', () => {
  it('exist for the inputs that are hardest to get right from the schema alone', () => {
    expect(withExamples.map((op) => op.name)).toEqual(
      expect.arrayContaining(['project-profile-patch', 'annotation-create', 'document-upload']),
    )
  })

  it.each(withExamples.map((op) => [op.name, op] as const))('%s: every example is an input it takes', (_name, op) => {
    expect(op.examples!.length).toBeLessThanOrEqual(3)
    for (const example of op.examples!) {
      expect(() => validateOperationInput(op, example)).not.toThrow()
      expect(() => resolvePath(op, example.params)).not.toThrow()
    }
    expect(inputSchemaOf(op).examples).toEqual(op.examples)
  })
})
