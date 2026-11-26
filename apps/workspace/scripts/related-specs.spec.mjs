// A spec runs when its imports reach a changed file; a selection that misses one lets a break merge green.
import { describe, expect, it } from 'vitest'
import { specsReaching } from './related-specs.mjs'

const input = (...imports) => ({ imports: imports.map((path) => ({ path, kind: 'import-statement' })) })

const graph = {
  'bff/a.spec.ts': input('bff/feature.ts'),
  'ui/b.spec.tsx': input('bff/hub.ts'),
  'workers/c.spec.mjs': input('workers/job.mjs'),
  'bff/feature.ts': input('bff/hub.ts'),
  'bff/hub.ts': input(),
  'workers/job.mjs': input(),
}

describe('specsReaching', () => {
  it('runs every spec above a changed module, through any number of importers', () => {
    expect(specsReaching(graph, ['bff/hub.ts'])).toEqual(['bff/a.spec.ts', 'ui/b.spec.tsx'])
  })

  it('runs a changed spec itself, and an .mjs spec through its imports', () => {
    expect(specsReaching(graph, ['ui/b.spec.tsx', 'workers/job.mjs'])).toEqual(['ui/b.spec.tsx', 'workers/c.spec.mjs'])
  })

  it('selects nothing for a file no spec imports', () => {
    expect(specsReaching(graph, ['ui/styles/app.css'])).toEqual([])
  })
})
