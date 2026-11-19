// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import postcss, { type AtRule, type Root } from 'postcss'
import { createElement } from 'react'
import { render, screen } from '@/test-utils'
import { parseSource, ts, walk } from '@/test-utils/source-ast'
import { SOURCE_DIRS, srcKey, srcJoin } from '@/test-utils/source-tree'
import { coarseFloorAxes } from '@/test-utils/touch-floor'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Chip } from '@/components/ui/chip'
import { CONTROL_HEIGHT } from '@/components/ui/control-height'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const GLOBALS = postcss.parse(readFileSync(srcJoin('app', 'globals.css'), 'utf8'))

const filesIn = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) filesIn(path, out)
    else if (/\.(tsx?|css)$/.test(entry)) out.push(path)
  }
  return out
}

const SOURCE_FILES = SOURCE_DIRS.flatMap((dir) => filesIn(join(process.cwd(), dir)))

const tokensOf = (text: string): string[] => text.split(/\s+/).filter((token) => token !== '')

const literalsOf = (file: string): string[] => {
  const texts: string[] = []
  walk(parseSource(file), (node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      texts.push(node.text)
    }
  })
  return texts
}

const tokensOfFile = (file: string): string[] => {
  if (!file.endsWith('.css')) return literalsOf(file).flatMap(tokensOf)
  const texts: string[] = []
  postcss
    .parse(readFileSync(file, 'utf8'))
    .walk((node) => {
      if (node.type === 'decl') texts.push(node.value)
      else if (node.type === 'rule') texts.push(node.selector)
      else if (node.type === 'atrule') texts.push(node.params)
    })
  return texts.flatMap(tokensOf)
}

const utilities = (): AtRule[] => {
  const found: AtRule[] = []
  GLOBALS.walkAtRules('utility', (rule) => {
    if (rule.params === 'touch-target') found.push(rule)
  })
  return found
}

const declaredValues = (node: Root | AtRule | undefined, prop: string): string[] => {
  const values: string[] = []
  node?.walkDecls(prop, (declaration) => {
    values.push(declaration.value)
  })
  return values
}

const mediaParams = (node: Root | AtRule | undefined): string[] => {
  const params: string[] = []
  node?.walkAtRules('media', (rule) => {
    params.push(rule.params)
  })
  return params
}

const isNearMiss = (token: string): boolean =>
  token.split(/[:!]/).some((part) => part.startsWith('touch-target') && part.length > 'touch-target'.length)

const MD_SIZED = new Set(['min-h-0', 'size-7', 'h-8', 'min-h-11', 'size-11', 'h-11'])

const isMdSized = (token: string): boolean => {
  const variants = token.split(':')
  const at = variants.indexOf('md')
  return at !== -1 && MD_SIZED.has((variants[at + 1] ?? '').split(/[!/]/)[0])
}

type Floor = 'both axes' | 'height, the row gives the width'

const hasCoarseSize = (element: Element, floor: Floor): boolean => {
  if (element.classList.contains('touch-target')) return true
  const axes = coarseFloorAxes(element.classList)
  return axes.height && (axes.width || floor !== 'both axes')
}

const classesOf = (element: Element | null | undefined): string[] => Array.from(element?.classList ?? [])

describe('touch-target utility', () => {
  it('is declared in globals.css', () => {
    expect(utilities().length).toBeGreaterThan(0)
  })

  it('only applies under a coarse pointer, so a mouse keeps the visible box', () => {
    expect(mediaParams(utilities()[0])).toContain('(pointer: coarse)')
  })

  it('reaches the 44px floor a fingertip needs', () => {
    const utility = utilities()[0]
    expect(declaredValues(utility, 'width')).toContain('max(100%, 44px)')
    expect(declaredValues(utility, 'height')).toContain('max(100%, 44px)')
  })

  it('has no near-miss spellings anywhere in src — those render a silent 16px target', () => {
    const typos: string[] = []
    for (const file of SOURCE_FILES) {
      if (file.endsWith('globals.css') || file.endsWith('touch-target.spec.ts')) continue
      for (const token of tokensOfFile(file)) {
        if (isNearMiss(token)) typos.push(`${srcKey(file)}: ${token}`)
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
      for (const token of tokensOfFile(file)) {
        if (isMdSized(token)) offenders.push(`${srcKey(file)}: ${token}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('control primitives carry a coarse-pointer touch size', () => {
  const PRIMITIVES: Array<[string, () => Element, Floor]> = [
    [
      'button.tsx',
      () => {
        render(createElement(Button, null, 'Go'))
        return screen.getByRole('button')
      },
      'both axes',
    ],
    [
      'input.tsx',
      () => {
        render(createElement(Input, { 'aria-label': 'Name' }))
        return screen.getByRole('textbox')
      },
      'height, the row gives the width',
    ],
    [
      'select.tsx',
      () => {
        render(
          createElement(
            Select,
            null,
            createElement(SelectTrigger, { 'aria-label': 'Kind' }, createElement(SelectValue)),
          ),
        )
        return screen.getByRole('combobox')
      },
      'height, the row gives the width',
    ],
    [
      'tabs.tsx',
      () => {
        render(
          createElement(
            Tabs,
            { defaultValue: 'a' },
            createElement(TabsList, null, createElement(TabsTrigger, { value: 'a' }, 'A')),
          ),
        )
        return screen.getByRole('tab')
      },
      'height, the row gives the width',
    ],
    [
      'dropdown-menu.tsx',
      () => {
        render(
          createElement(
            DropdownMenu,
            { open: true },
            createElement(DropdownMenuTrigger, null, 'Actions'),
            createElement(DropdownMenuContent, null, createElement(DropdownMenuItem, null, 'Item')),
          ),
        )
        return screen.getByRole('menuitem')
      },
      'height, the row gives the width',
    ],
    [
      'dialog.tsx',
      () => {
        render(
          createElement(
            Dialog,
            { open: true },
            createElement(DialogContent, null, createElement(DialogTitle, null, 'Title')),
          ),
        )
        return screen.getByRole('button')
      },
      'both axes',
    ],
    [
      'sheet.tsx',
      () => {
        render(
          createElement(
            Sheet,
            { open: true },
            createElement(SheetContent, null, createElement(SheetTitle, null, 'Title')),
          ),
        )
        return screen.getByRole('button')
      },
      'both axes',
    ],
    [
      'checkbox.tsx',
      () => {
        render(createElement(Checkbox, { 'aria-label': 'Agree' }))
        return screen.getByRole('checkbox')
      },
      'both axes',
    ],
    [
      'switch.tsx',
      () => {
        render(createElement(Switch, { 'aria-label': 'Live' }))
        return screen.getByRole('switch')
      },
      'both axes',
    ],
    [
      'chip.tsx',
      () => {
        render(createElement(Chip, { interactive: true }, 'Tag'))
        return screen.getByText('Tag')
      },
      'both axes',
    ],
  ]

  it.each(PRIMITIVES)('%s', (file, mount, floor) => {
    expect(hasCoarseSize(mount(), floor), file).toBe(true)
  })

  it('gives Button a floor on both axes — height alone leaves icon buttons narrow', () => {
    const heights = Object.values(CONTROL_HEIGHT)
      .flatMap((classes) => classes.split(' '))
      .filter((token) => token === 'pointer-coarse:h-11')
    expect(heights).toHaveLength(2)

    const mounted = (size: 'default' | 'sm' | 'icon'): string[] => {
      const { container } = render(createElement(Button, { size }, 'Go'))
      return classesOf(container.firstElementChild)
    }
    expect(mounted('default')).toEqual(expect.arrayContaining(CONTROL_HEIGHT.default.split(' ')))
    expect(mounted('sm')).toEqual(expect.arrayContaining(CONTROL_HEIGHT.sm.split(' ')))
    expect(mounted('icon')).toContain('pointer-coarse:size-11')
    expect(mounted('default')).toContain('pointer-coarse:min-w-11')
  })
})
