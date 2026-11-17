// @disk-inputs: bff/**
/**
 * @vitest-environment node
 */

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const LIB = join(dirname(fileURLToPath(import.meta.url)), '..')

function wireModules(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...wireModules(path))
    else if (entry.name.endsWith('-wire.ts')) found.push(path)
  }
  return found
}

const FORBIDDEN = [/from '@\/lib\/db'/, /from '@\/lib\/db\/schema'/, /import 'server-only'/, /from '[^']*\/(service|repository)'/]

describe('wire modules', () => {
  it('import no database layer, service or server-only module', () => {
    const offenders = wireModules(LIB).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return FORBIDDEN.filter((pattern) => pattern.test(source)).map(
        (pattern) => `${relative(LIB, file)}: ${pattern.source}`,
      )
    })
    expect(offenders).toEqual([])
  })
})
