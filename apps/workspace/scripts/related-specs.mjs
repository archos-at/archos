#!/usr/bin/env node
// The specs a pull request's changes reach (`task workspace:test:related`): the named specs, and every
// spec whose esbuild import graph reaches a named file. A mocked module counts, so it selects a little
// more than it must, never less: `node scripts/related-specs.mjs <path in apps/workspace>...`
import { globSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { importGraph } from './blast-radius.mjs'

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const SPEC = /\.(spec|test)\.(tsx?|mjs)$/

export function specFiles() {
  return globSync(
    [
      '{app,bff,ui,i18n,shared,types,utils,tests}/**/*.{spec,test}.{ts,tsx}',
      '*.{spec,test}.{ts,tsx}',
      '{purger,observability,workers,scripts}/**/*.spec.mjs',
    ],
    { cwd: UI, exclude: (name) => name === 'node_modules' || name === 'mocks' },
  ).sort()
}

export function specsReaching(inputs, files) {
  const importers = new Map()
  for (const [file, { imports }] of Object.entries(inputs)) {
    for (const edge of imports) {
      if (edge.external) continue
      if (!importers.has(edge.path)) importers.set(edge.path, [])
      importers.get(edge.path).push(file)
    }
  }
  const seen = new Set(files)
  const queue = [...files]
  while (queue.length) {
    for (const importer of importers.get(queue.pop()) ?? []) {
      if (!seen.has(importer)) {
        seen.add(importer)
        queue.push(importer)
      }
    }
  }
  return [...seen].filter((file) => SPEC.test(file)).sort()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const specs = specFiles()
  const known = new Set(specs)
  const related = specsReaching(await importGraph(specs), process.argv.slice(2))
  console.log(related.filter((file) => known.has(file)).join('\n'))
}
