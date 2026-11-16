// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { blankComments } from '../../../scripts/check-static-utility-modifiers.mjs'
import { SOURCE_DIRS, srcKey, srcJoin } from '@/test-utils/source-tree'


const readCode = (file: string): string => blankComments(readFileSync(file, 'utf8')) as string

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.tsx?$/.test(entry)) out.push(path)
  }
  return out
}

const SOURCE_FILES = SOURCE_DIRS.flatMap((dir) => walk(join(process.cwd(), dir))).filter((f) => !f.endsWith('mobile-affordances.spec.ts'))

const relative = (file: string): string => srcKey(file)

const classRegions = (source: string): string[] => {
  const regions: string[] = []
  for (const match of source.matchAll(/\bcn\(/g)) {
    let depth = 0
    let i = match.index + match[0].length - 1
    for (; i < source.length; i += 1) {
      if (source[i] === '(') depth += 1
      else if (source[i] === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    regions.push(source.slice(match.index, i + 1))
  }
  for (const match of source.matchAll(/className=(?:"([^"]*)"|'([^']*)')/g)) {
    regions.push(match[1] ?? match[2] ?? '')
  }
  return regions
}

describe('a hover reveal always has a second way in', () => {
  it('never hides a control behind hover alone', () => {
    const offenders: string[] = []
    for (const file of SOURCE_FILES) {
      for (const region of classRegions(readCode(file))) {
        if (!region.includes('group-hover:opacity-100')) continue
        if (!/(?:^|[\s'"])opacity-0(?:[\s'"]|$)/.test(region)) continue
        if (region.includes('pointer-coarse:opacity-100')) continue
        if (region.includes('md:opacity-0')) continue
        offenders.push(`${relative(file)}: ${region.slice(0, 100).replace(/\s+/g, ' ')}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('never hides a control at rest on a screen that has no hover (a touch tablet past md)', () => {
    const offenders: string[] = []
    for (const file of SOURCE_FILES) {
      for (const region of classRegions(readCode(file))) {
        if (!/(?:^|[\s'"])md:opacity-0(?:[\s'"]|$)/.test(region)) continue
        if (region.includes('pointer-coarse:opacity-100')) continue
        offenders.push(`${relative(file)}: ${region.slice(0, 100).replace(/\s+/g, ' ')}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('no height is measured against the large viewport', () => {
  const VH = /(?<![\w-])\d+(?:\.\d+)?vh\b|\b(?:min-h|max-h|h)-screen\b/g

  const PRODUCT_FILES = SOURCE_FILES.filter(
    (f) => !/\.(?:spec|test)\.tsx?$/.test(f) && !relative(f).startsWith('app/dev/')
  )

  const vhOffenders = (): Map<string, string[]> => {
    const found = new Map<string, string[]>()
    for (const file of PRODUCT_FILES) {
      const hits = readCode(file).match(VH)
      if (hits) found.set(relative(file), hits)
    }
    return found
  }

  it('sizes nothing in vh', () => {
    expect([...vhOffenders()]).toEqual([])
  })

  it('holds the stylesheet to the same rule', () => {
    for (const sheet of ['app/globals.css', 'styles/tokens.css']) {
      expect(readFileSync(srcJoin(...sheet.split('/')), 'utf8').match(VH), sheet).toBeNull()
    }
  })
})

describe('no text field invites the iOS zoom', () => {
  const fieldTags = (source: string): string[] => {
    const tags: string[] = []
    for (const match of source.matchAll(/<(?:input|textarea)\b/g)) {
      let depth = 0
      let quote: string | null = null
      let i = match.index + match[0].length
      for (; i < source.length; i += 1) {
        const c = source[i]
        if (quote) {
          if (c === quote) quote = null
        } else if (c === '"' || c === "'" || c === '`') quote = c
        else if (c === '{') depth += 1
        else if (c === '}') depth -= 1
        else if (c === '>' && depth === 0) break
      }
      tags.push(source.slice(match.index, i + 1))
    }
    return tags
  }
  const EXEMPT_TYPE = /type=(?:"|')(?:file|range|checkbox|radio|hidden)(?:"|')|type=\{'(?:file|range)'\}/
  const VISUALLY_GONE = /className=(?:"|')(?:[^"']*\s)?(?:sr-only|hidden)(?:\s[^"']*)?(?:"|')/

  it('gives every hand-written field a 16px floor where a soft keyboard is likely', () => {
    const offenders: string[] = []
    for (const file of SOURCE_FILES) {
      if (file.endsWith('.spec.tsx') || file.endsWith('.test.tsx')) continue
      const source = readCode(file)
      for (const tag of fieldTags(source)) {
        if (EXEMPT_TYPE.test(tag) || VISUALLY_GONE.test(tag)) continue
        if (!/\btext-(?:xs|sm|\[1[0-5](?:\.\d+)?px\])(?![\w-])/.test(tag)) continue
        if (/\bpointer-coarse:text-base\b/.test(tag)) continue
        offenders.push(`${relative(file)}: ${tag.slice(0, 90).replace(/\s+/g, ' ')}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('never rebuilds the floor out of a viewport breakpoint', () => {
    const offenders: string[] = []
    const BREAKPOINT_SHRINK = /\b(?:sm|md|lg|xl|2xl):text-(?:xs|sm|\[1[0-5](?:\.\d+)?px\])(?![\w-])/g
    for (const file of SOURCE_FILES) {
      if (file.endsWith('.spec.tsx') || file.endsWith('.test.tsx')) continue
      const source = readCode(file)
      for (const tag of fieldTags(source)) {
        if (EXEMPT_TYPE.test(tag) || VISUALLY_GONE.test(tag)) continue
        for (const shrink of tag.match(BREAKPOINT_SHRINK) ?? []) {
          offenders.push(`${relative(file)}: ${shrink}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the shared field primitives raise themselves on a coarse pointer', () => {
    for (const file of ['input.tsx', 'textarea.tsx', 'select.tsx']) {
      const source = readCode(srcJoin('components', 'ui', file))
      expect(source, file).toContain('pointer-coarse:text-base')
      expect(source, file).not.toMatch(/\bmd:text-sm\b/)
    }
  })
})

describe('no library stylesheet keeps the page scroll', () => {
  const FLOW = srcJoin('features', 'chat', 'components', 'reasoning', 'flow', 'flow-inner.tsx')

  it('the reasoning graph opts into the override', () => {
    const source = readCode(FLOW)
    expect(source).toContain('reasoning-flow-scrollable')
    for (const prop of ['panOnDrag', 'panOnScroll', 'zoomOnScroll', 'zoomOnPinch']) {
      expect(source).toMatch(new RegExp(`${prop}=\\{false\\}`))
    }
  })

  it('globals.css carries the rule the class refers to', () => {
    const css = readFileSync(srcJoin('app', 'globals.css'), 'utf8')
    expect(css).toMatch(/\.reasoning-flow-scrollable\s+\.react-flow__pane\s*\{[^}]*touch-action:\s*auto/)
  })

  it('React Flow still ships the default this exists to undo', () => {
    const upstream = readFileSync(
      join(process.cwd(), 'node_modules', '@xyflow', 'react', 'dist', 'style.css'),
      'utf8',
    )
    expect(upstream).toMatch(/\.react-flow__pane\s*\{[^}]*touch-action:\s*none/)
  })
})

describe('the soft keyboard is told what the action key does', () => {
  it.each([
    ['components/ui/search-field.tsx', 'search'],
    ['features/layout/components/input-area/composer-field.tsx', 'send'],
    ['components/ui/type-to-confirm-dialog.tsx', 'done'],
  ])('%s declares enterKeyHint="%s"', (file, hint) => {
    const source = readCode(srcJoin(...file.split('/')))
    expect(source).toContain(`enterKeyHint="${hint}"`)
  })

  it('keeps the phone from editing a search query on its way in', () => {
    const source = readCode(srcJoin('components', 'ui', 'search-field.tsx'))
    expect(source).toMatch(/autoCapitalize="off"/)
    expect(source).toMatch(/autoCorrect="off"/)
  })
})

describe('every floating surface fits the screen it opens on', () => {
  it.each([
    ['dropdown-menu.tsx', 'dropdown-menu', 2],
    ['context-menu.tsx', 'context-menu', 2],
    ['select.tsx', 'select', 1],
  ])('%s caps every menu, submenus included, to the room it has', (file, primitive, surfaces) => {
    const source = readCode(srcJoin('components', 'ui', file))
    for (const axis of ['height', 'width']) {
      const cap = `max-${axis === 'height' ? 'h' : 'w'}-(--radix-${primitive}-content-available-${axis})`
      expect(source.split(cap).length - 1, `${file}: ${cap}`).toBe(surfaces)
    }
  })

  it.each([
    ['popover.tsx', 'popover'],
    ['tooltip.tsx', 'tooltip'],
  ])('%s is never wider than the room it has', (file, primitive) => {
    expect(readCode(srcJoin('components', 'ui', file))).toContain(
      `max-w-(--radix-${primitive}-content-available-width)`
    )
  })
})

describe('a focus ring is for the keyboard', () => {
  const css = blankComments(readFileSync(srcJoin('app', 'globals.css'), 'utf8')) as string

  const layers = (): Array<[number, number]> => {
    const out: Array<[number, number]> = []
    for (const match of css.matchAll(/@layer\s+[\w-]+\s*\{/g)) {
      let depth = 0
      for (let i = match.index + match[0].length - 1; i < css.length; i += 1) {
        if (css[i] === '{') depth += 1
        else if (css[i] === '}' && --depth === 0) {
          out.push([match.index, i])
          break
        }
      }
    }
    return out
  }

  it('keeps the global :focus-visible outline unlayered, so outline-none cannot drop it', () => {
    const outline = /(^|\n):focus-visible\s*\{\s*outline:\s*2px solid var\(--ring\)/.exec(css)
    expect(outline).not.toBeNull()
    const at = outline?.index ?? -1
    expect(layers().some(([start, end]) => at > start && at < end)).toBe(false)
  })

  it('draws no frame around an overlay panel that holds the focus itself, nor inside a cmdk field', () => {
    expect(css).toMatch(
      /:is\(\[role='dialog'\], \[role='alertdialog'\]\):focus-visible,\s*\[cmdk-input\]:focus-visible\s*\{\s*outline:\s*none/
    )
  })
})

describe('a dialog footer is pinned by the primitive, not by hand', () => {
  it('no DialogFooter carries its own sticky', () => {
    const offenders = SOURCE_FILES.filter((f) => !/\.(?:spec|test)\.tsx?$/.test(f))
      .flatMap((file) =>
        [...readCode(file).matchAll(/<DialogFooter\b[^>]*className=(?:"[^"]*"|\{[^}]*\})/g)]
          .filter((match) => /(?<![\w-])sticky\b/.test(match[0]))
          .map(() => relative(file))
      )
    expect(offenders).toEqual([])
  })
})
