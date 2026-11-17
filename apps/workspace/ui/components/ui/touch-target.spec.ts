// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { SOURCE_DIRS, srcKey, srcJoin } from '@/test-utils/source-tree'

const GLOBALS_CSS = readFileSync(srcJoin('app', 'globals.css'), 'utf8')

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(tsx?|css)$/.test(entry)) out.push(path)
  }
  return out
}

const SOURCE_FILES = SOURCE_DIRS.flatMap((dir) => walk(join(process.cwd(), dir)))

describe('touch-target utility', () => {
  it('is declared in globals.css', () => {
    expect(GLOBALS_CSS).toMatch(/@utility\s+touch-target\s*\{/)
  })

  it('only applies under a coarse pointer, so a mouse keeps the visible box', () => {
    const body = GLOBALS_CSS.split(/@utility\s+touch-target\s*\{/)[1] ?? ''
    expect(body.slice(0, body.indexOf('\n}'))).toMatch(/@media\s*\(pointer:\s*coarse\)/)
  })

  it('reaches the 44px floor a fingertip needs', () => {
    const body = GLOBALS_CSS.split(/@utility\s+touch-target\s*\{/)[1] ?? ''
    const decl = body.slice(0, body.indexOf('\n}'))
    expect(decl).toMatch(/width:\s*max\(100%,\s*44px\)/)
    expect(decl).toMatch(/height:\s*max\(100%,\s*44px\)/)
  })

  it('has no near-miss spellings anywhere in src — those render a silent 16px target', () => {
    const typos: string[] = []
    for (const file of SOURCE_FILES) {
      if (file.endsWith('globals.css') || file.endsWith('touch-target.spec.ts')) continue
      for (const match of readFileSync(file, 'utf8').matchAll(/\btouch-target[\w-]+/g)) {
        typos.push(`${srcKey(file)}: ${match[0]}`)
      }
    }
    expect(typos).toEqual([])
  })
})

describe('touch sizing uses one axis', () => {
  it('sizes targets on pointer-coarse, never on the md breakpoint', () => {
    const offenders: string[] = []
    for (const file of SOURCE_FILES) {
      if (file.endsWith('touch-target.spec.ts')) continue
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(/\bmd:(?:min-h-0|size-7|h-8|min-h-11|size-11|h-11)\b/g)) {
        offenders.push(`${srcKey(file)}: ${match[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('control primitives carry a coarse-pointer touch size', () => {
  it.each([
    ['button.tsx'],
    ['input.tsx'],
    ['select.tsx'],
    ['tabs.tsx'],
    ['dropdown-menu.tsx'],
    ['dialog.tsx'],
    ['sheet.tsx'],
    ['checkbox.tsx'],
    ['switch.tsx'],
    ['chip.tsx'],
  ])('%s', (file) => {
    const source = readFileSync(srcJoin('components', 'ui', file), 'utf8')
    expect(source).toMatch(/pointer-coarse:|touch-target/)
  })

  it('gives Button a floor on both axes — height alone leaves icon buttons narrow', () => {
    const source = readFileSync(srcJoin('components', 'ui', 'button.tsx'), 'utf8')
    const heights = readFileSync(srcJoin('components', 'ui', 'control-height.ts'), 'utf8')
    expect(source).toMatch(/CONTROL_HEIGHT\.(default|sm)/)
    expect(heights.match(/pointer-coarse:h-11/g)?.length).toBe(2)
    expect(source).toMatch(/pointer-coarse:size-11/)
    expect(source).toMatch(/pointer-coarse:min-w-11/)
  })
})
