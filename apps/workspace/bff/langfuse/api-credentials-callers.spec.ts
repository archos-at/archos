// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
/**
 * @vitest-environment node
 */

import { dirname, join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as traceClient from '../../workers/langfuse-traces.js'
import { exportedNames, importsOf, nodesOf, parseSource, productionSources, ts } from '@/test-utils/source-ast'
import { srcPath } from '@/test-utils/source-tree'

const UI = process.cwd()
const SCHEDULED_TASKS = 'schedulingTasks'
const SCRIPT_EXTENSION = /\.[cm]?[jt]sx?$/

const CLIENT_FUNCTIONS = new Set(
  Object.entries(traceClient)
    .filter(([, value]) => typeof value === 'function')
    .map(([name]) => name),
)

function moduleOf(path: string): string {
  return path.replace(SCRIPT_EXTENSION, '').replace(/\/index$/, '')
}

function target(importer: string, specifier: string): string | undefined {
  if (specifier.startsWith('@/')) return moduleOf(relative(UI, srcPath(specifier.slice(2))).replace(/\\/g, '/'))
  if (specifier.startsWith('.')) return moduleOf(join(dirname(importer), specifier).replace(/\\/g, '/'))
  return undefined
}

function reachesForTheClient(source: ts.SourceFile): boolean {
  return nodesOf(source, ts.isIdentifier).some((identifier) => CLIENT_FUNCTIONS.has(identifier.text))
}

describe("Langfuse's API credentials", () => {
  const sources = new Map(productionSources().map((path) => [path, parseSource(path)]))
  const importedBy = new Map<string, string[]>()
  for (const [path, source] of sources) {
    for (const edge of importsOf(source)) {
      const imported = target(path, edge.specifier)
      if (imported) importedBy.set(imported, [...(importedBy.get(imported) ?? []), path])
    }
  }
  const scheduler = [...sources].filter(([, source]) => exportedNames(source).includes(SCHEDULED_TASKS)).map(([path]) => path)
  const callers = [...sources].filter(([, source]) => reachesForTheClient(source)).map(([path]) => path)

  it('are read by a trace client the BFF can reach for', () => {
    expect(CLIENT_FUNCTIONS.size).toBeGreaterThan(0)
    expect(scheduler).toHaveLength(1)
    expect(callers).not.toEqual([])
  })

  it("are not reached for by the BFF's own code, outside the sweeps only the scheduler in bff-jobs runs", () => {
    const outside = callers.filter((path) => {
      const importers = importedBy.get(moduleOf(path)) ?? []
      return importers.length === 0 || importers.some((importer) => !scheduler.includes(importer))
    })
    expect(outside, 'The trace client erases nothing outside the purger and bff-jobs, which alone hold the keys').toEqual([])
  })
})
