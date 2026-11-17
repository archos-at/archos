// @disk-inputs: bff/api/api-error.ts, bff/api/errors.ts
/**
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BYTES_PER_MB } from '@/shared/config/request-body-limit'
import { formatMegabytes } from './errors'

function valueImports(file: string): string[] {
  const source = readFileSync(join(__dirname, file), 'utf8')
  return [...new Set([...source.matchAll(/^(?:import|export)\s+(?!type\b)[^']*?from\s+'([^']+)'/gm)].map((match) => match[1]))]
}

describe('lib/api/errors.ts', () => {
  it('imports nothing but types and its import-free base', () => {
    expect(valueImports('errors.ts'), 'Move the code that needs the import out of errors.ts, or redeclare the constant').toEqual([
      './api-error',
    ])
    expect(valueImports('api-error.ts')).toEqual([])
  })

  it('counts a megabyte the way the request body limit does', () => {
    expect(formatMegabytes(BYTES_PER_MB)).toBe('1')
  })
})
