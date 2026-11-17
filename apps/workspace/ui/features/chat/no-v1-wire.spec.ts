// @disk-inputs: ui/adapters/api/**, ui/features/chat/**
/**
 * @vitest-environment node
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const SRC = join(process.cwd(), 'ui')
const ROOTS = ['features/chat', 'adapters/api'].map((dir) => join(SRC, dir))
const THIS_FILE = join(SRC, 'features/chat/no-v1-wire.spec.ts')

const V1_WIRE = new RegExp(
  ['Function (Start|Complete)', '## Trace-Lanes', 'parseFunction' + 'Name'].join('|')
)

const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return filesUnder(path)
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })

describe('no v1 wire reader in the chat or the socket adapter', () => {
  test('no file names a Function frame, a Trace-Lanes block or the function-name parser', () => {
    const offenders = ROOTS.flatMap(filesUnder)
      .filter((file) => file !== THIS_FILE)
      .filter((file) => V1_WIRE.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file))
    expect(offenders).toEqual([])
  })
})
