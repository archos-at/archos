// @disk-inputs: app/**, ui/**
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { importsOf, nodesOf, parseSource, productionSources, ts } from '@/test-utils/source-ast'

const ROOT = join(__dirname, '..')
const STYLESHEET = /^@xyflow\/react\/dist\/(style|base)\.css$/

const isReactFlowElement = (node: ts.Node): node is ts.JsxOpeningElement | ts.JsxSelfClosingElement =>
  (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText() === 'ReactFlow'

const renderSites: [string, ts.SourceFile][] = productionSources(ROOT)
  .filter((file) => file.endsWith('.tsx') && (file.startsWith('app/') || file.startsWith('ui/')))
  .map((file): [string, ts.SourceFile] => [file, parseSource(file, ROOT)])
  .filter(([, source]) => nodesOf(source, isReactFlowElement).length > 0)

describe('React Flow stylesheet', () => {
  it('finds the render sites', () => {
    expect(renderSites.length).toBeGreaterThan(0)
  })

  it.each(renderSites)('%s imports the stylesheet', (_file, source) => {
    expect(importsOf(source).some((edge) => STYLESHEET.test(edge.specifier))).toBe(true)
  })
})
