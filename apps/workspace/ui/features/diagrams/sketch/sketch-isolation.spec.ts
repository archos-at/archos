// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SOURCE_DIRS, srcKey } from '@/test-utils/source-tree'


function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : []
  })
}

const files = SOURCE_DIRS.flatMap((dir) => sourceFiles(join(process.cwd(), dir))).map((path) => ({ path: srcKey(path), text: readFileSync(path, 'utf8') }))

describe('the sketch editor stays out of the chat bundle', () => {
  it('imports @excalidraw/excalidraw from the canvas and the renderer only', () => {
    const importers = files.filter(({ text }) => /from\s+['"]@excalidraw\/excalidraw(?:\/[^'"]*)?['"]/.test(text))
    expect(importers.map(({ path }) => path).sort()).toEqual([
      'features/diagrams/sketch/sketch-canvas.tsx',
      'features/diagrams/sketch/sketch-render.ts',
    ])
  })

  it.each([
    ['sketch-canvas', 'features/diagrams/sketch/sketch-dialog.tsx'],
    ['sketch-render', 'features/diagrams/components/sketch-figure.tsx'],
  ])('reaches %s only through a dynamic import, and only from %s', (module, importer) => {
    const TYPE_ONLY_IMPORT = /import\s+type\s[^'"]*?from\s*['"][^'"]+['"]/g
    const STATIC_EDGE = new RegExp(`(?:from\\s*|import\\s+)['"][^'"]*${module}['"]`)
    const statics = files.filter(({ text }) => STATIC_EDGE.test(text.replace(TYPE_ONLY_IMPORT, '')))
    expect(statics.map(({ path }) => path)).toEqual([])
    const dynamics = files.filter(({ text }) => new RegExp(`import\\(\\s*['"][^'"]*${module}['"]\\s*\\)`).test(text))
    expect(dynamics.map(({ path }) => path)).toEqual([importer])
  })
})
