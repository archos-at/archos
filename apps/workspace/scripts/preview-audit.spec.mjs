// @vitest-environment node
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { inShard, judgeAgainstBaseline, parseArgs } from './preview-audit.mjs'

const baselineWith = (keys) => {
  const file = join(mkdtempSync(join(tmpdir(), 'preview-audit-')), 'baseline.json')
  writeFileSync(file, JSON.stringify(keys))
  return file
}
const finding = { count: 1, sample: '32x32', help: 'under 44x44' }
const judge = (baseline, keys, { routes = ['/dev/inbox'], argv = [] } = {}) =>
  judgeAgainstBaseline({
    baseline,
    found: new Map(keys.map((key) => [key, finding])),
    routes,
    discovered: ['/dev/inbox', '/dev/files-page'],
    args: parseArgs(argv),
    title: 'phone',
  })

afterEach(() => vi.restoreAllMocks())

describe('judging findings against the baseline', () => {
  it('passes what the baseline already lists', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(judge(baselineWith(['/dev/inbox 360 overflow']), ['/dev/inbox 360 overflow'])).toBe(0)
  })

  it('fails a new finding', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(judge(baselineWith([]), ['/dev/inbox 360 target a "Offene Punkte"'])).toBe(1)
  })

  it('fails an entry of an audited route that no longer occurs, so the list only shrinks', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(judge(baselineWith(['/dev/inbox 360 overflow']), [])).toBe(1)
  })

  it('leaves alone the entries of a route this run (a shard, a named route) did not audit', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(judge(baselineWith(['/dev/files-page 360 overflow']), [], { argv: ['/dev/inbox'] })).toBe(0)
  })

  it('drops the entries of a route that no longer exists when it writes', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const file = baselineWith(['/dev/retired 390 overflow', '/dev/files-page 390 overflow'])
    judge(file, [], { argv: ['--write-baseline'] })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(['/dev/files-page 390 overflow'])
  })

  it('writes the findings of the audited routes and keeps the others', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const file = baselineWith(['/dev/files-page 390 overflow', '/dev/inbox 390 overflow'])
    expect(judge(file, ['/dev/inbox 360 overflow'], { argv: ['--write-baseline'] })).toBe(0)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(['/dev/files-page 390 overflow', '/dev/inbox 360 overflow'])
  })
})

describe('the command line', () => {
  it('spreads every n-th route over the shards', () => {
    expect(inShard(['a', 'b', 'c', 'd', 'e'], parseArgs(['--shard', '2/2']).shard)).toEqual(['b', 'd'])
  })

  it('refuses a shard outside 1..n', () => {
    expect(() => parseArgs(['--shard', '3/2'])).toThrow(/--shard/)
  })
})
