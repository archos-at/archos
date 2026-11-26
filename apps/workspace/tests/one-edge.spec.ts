// @disk-inputs: app/**, ui/**, shared/**
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postcss from 'postcss'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'
import { toast } from 'sonner'
import { render, screen } from '@/test-utils'
import { callsTo, nodesOf, parseSource, productionSources, ts, walk } from '@/test-utils/source-ast'
import { Card } from '@/components/ui/card'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toaster } from '@/components/ui/sonner'

const ROOT = join(__dirname, '..')

const RINGED_SHADOW = /^(?:[a-z-]+:|data-\[[^\]]+\]:)*shadow(?:-(?:2xs|xs|sm|md|lg|xl|sheet))?$/
const NEUTRAL_BORDER = /^(?:dark:)?border$/
const SHADOWED_PRIMITIVES = new Set([
  'Card',
  'PopoverContent',
  'DropdownMenuContent',
  'DropdownMenuSubContent',
  'ContextMenuContent',
  'ContextMenuSubContent',
  'SelectContent',
  'DialogContent',
])

const tokensOf = (text: string): string[] => text.split(/\s+/)

const isDouble = (tokens: string[]): boolean =>
  tokens.some((t) => NEUTRAL_BORDER.test(t)) && tokens.some((t) => RINGED_SHADOW.test(t))

const tradesRingForBorder = (value: string): boolean => {
  const tokens = tokensOf(value)
  return tokens.includes('shadow-none') && tokens.some((t) => NEUTRAL_BORDER.test(t))
}

const literalsOf = (root: ts.Node): string[] => {
  const texts: string[] = []
  walk(root, (node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      texts.push(node.text)
    }
  })
  return texts
}

const isShadowedPrimitive = (node: ts.Node): node is ts.JsxOpeningElement | ts.JsxSelfClosingElement =>
  (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && SHADOWED_PRIMITIVES.has(node.tagName.getText())

function offendersIn(file: string): string[] {
  const source = parseSource(file)
  const strings = literalsOf(source).filter((value) => isDouble(tokensOf(value)))
  const composed = callsTo(source, 'cn')
    .map((call) => literalsOf(call).filter((value) => !tradesRingForBorder(value)).join(' '))
    .filter((value) => isDouble(tokensOf(value)))
  const handed = nodesOf(source, isShadowedPrimitive)
    .map((element) => `<${element.tagName.getText()}> ${literalsOf(element.attributes).join(' ')}`)
    .filter((value) => tokensOf(value).some((t) => NEUTRAL_BORDER.test(t)))
  return [...strings, ...composed, ...handed].map((value) => `${file}: ${value.slice(0, 120)}`)
}

const edgeOf = (element: Element): string[] => (isDouble(Array.from(element.classList)) ? [element.className] : [])

const SHARED_SURFACES: Array<[string, () => Promise<Element>]> = [
  [
    'card',
    async () => {
      const { container } = render(createElement(Card, null, 'Body'))
      return container.firstElementChild as Element
    },
  ],
  [
    'popover',
    async () => {
      render(createElement(Popover, { open: true }, createElement(PopoverContent, null, 'Body')))
      return screen.getByText('Body')
    },
  ],
  [
    'dropdown-menu',
    async () => {
      render(
        createElement(
          DropdownMenu,
          { open: true },
          createElement(DropdownMenuTrigger, null, 'Actions'),
          createElement(DropdownMenuContent, null, createElement(DropdownMenuItem, null, 'Item')),
        ),
      )
      return screen.getByRole('menu')
    },
  ],
  [
    'context-menu',
    async () => {
      render(
        createElement(
          ContextMenu,
          { open: true },
          createElement(ContextMenuTrigger, null, 'Canvas'),
          createElement(ContextMenuContent, null, createElement(ContextMenuItem, null, 'Item')),
        ),
      )
      return screen.getByRole('menu')
    },
  ],
  [
    'select',
    async () => {
      render(
        createElement(
          Select,
          { open: true },
          createElement(SelectTrigger, { 'aria-label': 'Kind' }, createElement(SelectValue)),
          createElement(SelectContent, null, createElement(SelectItem, { value: 'a' }, 'A')),
        ),
      )
      return screen.getByRole('listbox')
    },
  ],
  [
    'dialog',
    async () => {
      render(
        createElement(
          Dialog,
          { open: true },
          createElement(DialogContent, null, createElement(DialogTitle, null, 'Title')),
        ),
      )
      return screen.getByRole('dialog')
    },
  ],
  [
    'sonner',
    async () => {
      render(createElement(Toaster))
      toast('Body')
      const text = await screen.findByText('Body')
      return text.closest('[data-sonner-toast]') as Element
    },
  ],
]

describe('a surface draws one edge', () => {
  it('no class string sets a neutral border beside a ringed shadow', () => {
    const offenders = productionSources()
      .filter((file) => /^(app|ui|shared)\//.test(file) && !file.startsWith('app/dev/'))
      .flatMap(offendersIn)
    expect(offenders).toEqual([])
  })

  it.each(SHARED_SURFACES)('the %s takes its edge from the shadow alone', async (_name, mount) => {
    expect(edgeOf(await mount())).toEqual([])
  })

  it('the tokens still draw the ring, which is why the border has to go', () => {
    const tokens = postcss.parse(readFileSync(join(ROOT, 'ui/styles/tokens.css'), 'utf8'))
    const valuesOf = (prop: string): string[] => {
      const values: string[] = []
      tokens.walkDecls(prop, (declaration) => {
        values.push(declaration.value)
      })
      return values
    }
    expect(valuesOf('--elevation-xs').some((value) => value.startsWith('0 0 0 1px var(--edge)'))).toBe(true)
    expect(valuesOf('--elevation-1').some((value) => value.startsWith('0 0 0 1px var(--edge)'))).toBe(true)
  })
})
