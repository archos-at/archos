/**
 * @vitest-environment node
 */

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BYTES_PER_MB } from '@/shared/config/request-body-limit'
import { formatMegabytes } from './errors'

function ownModulesLoadedBy(file: string): string[] {
  const script = String.raw`
    const loaded = []
    Bun.plugin({
      name: 'record-loads',
      setup(build) {
        build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
          loaded.push(args.path)
          return { contents: await Bun.file(args.path).text(), loader: args.path.endsWith('.ts') ? 'ts' : 'js' }
        })
      },
    })
    await import(${JSON.stringify(file)})
    console.log(JSON.stringify(loaded))
  `
  const run = spawnSync('bun', ['-e', script], { encoding: 'utf8' })
  expect(run.status, run.stderr).toBe(0)
  return (JSON.parse(run.stdout) as string[]).sort()
}

describe('lib/api/errors.ts', () => {
  it('loads nothing but its import-free base', () => {
    expect(ownModulesLoadedBy(join(__dirname, 'errors.ts')), 'Move the code that needs the import out of errors.ts, or redeclare the constant').toEqual([
      join(__dirname, 'api-error.ts'),
      join(__dirname, 'errors.ts'),
    ])
    expect(ownModulesLoadedBy(join(__dirname, 'api-error.ts'))).toEqual([join(__dirname, 'api-error.ts')])
  })

  it('counts a megabyte the way the request body limit does', () => {
    expect(formatMegabytes(BYTES_PER_MB)).toBe('1')
  })
})
