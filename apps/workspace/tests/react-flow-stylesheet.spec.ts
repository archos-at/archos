// @disk-inputs: app/**, ui/**
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')
const STYLESHEET = /import\s+['"]@xyflow\/react\/dist\/(style|base)\.css['"]/

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : tsxFiles(path)
    return entry.name.endsWith('.tsx') && !entry.name.includes('.spec.') ? [path] : []
  })
}

describe('React Flow stylesheet', () => {
  const renderSites = ['app', 'ui']
    .flatMap((dir) => tsxFiles(join(ROOT, dir)))
    .filter((file) => /<ReactFlow\b/.test(readFileSync(file, 'utf8')))

  it('finds the render sites', () => {
    expect(renderSites.length).toBeGreaterThan(0)
  })

  it.each(renderSites.map((file) => [relative(ROOT, file), file]))(
    '%s imports the stylesheet',
    (_name, file) => {
      expect(readFileSync(file, 'utf8')).toMatch(STYLESHEET)
    }
  )
})
