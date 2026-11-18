// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
import { describe, expect, it } from 'vitest'
import { importsOf, parseSource, productionSources, ts } from '@/test-utils/source-ast'

const modules = productionSources().map((file) => ({ file, edges: importsOf(parseSource(file)) }))

const isStatic = (edge: { node: ts.Node }): boolean => !ts.isCallExpression(edge.node)

describe('the sketch editor stays out of the chat bundle', () => {
  it('imports @excalidraw/excalidraw from the canvas and the renderer only', () => {
    const importers = modules
      .filter(({ edges }) =>
        edges.some(
          (edge) =>
            isStatic(edge) &&
            (edge.specifier === '@excalidraw/excalidraw' || edge.specifier.startsWith('@excalidraw/excalidraw/'))
        )
      )
      .map(({ file }) => file)
    expect(importers.sort()).toEqual([
      'ui/features/diagrams/sketch/sketch-canvas.tsx',
      'ui/features/diagrams/sketch/sketch-render.ts',
    ])
  })

  it.each([
    ['sketch-canvas', 'ui/features/diagrams/sketch/sketch-dialog.tsx'],
    ['sketch-render', 'ui/features/diagrams/components/sketch-figure.tsx'],
  ])('reaches %s only through a dynamic import, and only from %s', (module, importer) => {
    const statics = modules
      .filter(({ edges }) => edges.some((edge) => isStatic(edge) && !edge.typeOnly && edge.specifier.endsWith(module)))
      .map(({ file }) => file)
    expect(statics).toEqual([])
    const dynamics = modules
      .filter(({ edges }) => edges.some((edge) => !isStatic(edge) && edge.specifier.endsWith(module)))
      .map(({ file }) => file)
    expect(dynamics).toEqual([importer])
  })
})
