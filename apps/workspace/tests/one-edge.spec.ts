// @disk-inputs: app/**, ui/**, shared/**
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')

const RINGED_SHADOW = /^(?:[a-z-]+:|data-\[[^\]]+\]:)*shadow(?:-(?:2xs|xs|sm|md|lg|xl|sheet))?$/
const NEUTRAL_BORDER = /^(?:dark:)?border$/

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = join(dir, name)
    if (statSync(join(ROOT, path)).isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.') || path === join('app', 'dev')) continue
      out.push(...sourceFiles(path))
    } else if (/\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name)) {
      out.push(relative(ROOT, join(ROOT, path)))
    }
  }
  return out
}

function classStrings(text: string): string[] {
  return [...text.matchAll(/(['"`])((?:(?!\1)[^\n])*)\1/g)].map((match) => match[2] ?? '')
}

const isDouble = (tokens: string[]): boolean =>
  tokens.some((t) => NEUTRAL_BORDER.test(t)) && tokens.some((t) => RINGED_SHADOW.test(t))

const tradesRingForBorder = (value: string): boolean => {
  const tokens = value.split(/\s+/)
  return tokens.includes('shadow-none') && tokens.some((t) => NEUTRAL_BORDER.test(t))
}

function cnCalls(text: string): string[] {
  const calls: string[] = []
  for (let at = text.indexOf('cn('); at !== -1; at = text.indexOf('cn(', at + 3)) {
    let depth = 0
    let end = at + 2
    for (; end < text.length; end++) {
      if (text[end] === '(') depth++
      else if (text[end] === ')' && --depth === 0) break
    }
    calls.push(classStrings(text.slice(at, end)).filter((value) => !tradesRingForBorder(value)).join(' '))
  }
  return calls
}

const SHADOWED_PRIMITIVES = /<(Card|PopoverContent|DropdownMenuContent|DropdownMenuSubContent|ContextMenuContent|ContextMenuSubContent|SelectContent|DialogContent)\b([^>]*?)>/g

function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/[^'"`\n]*$/gm, '')
}

function doubles(file: string): string[] {
  const text = withoutComments(readFileSync(join(ROOT, file), 'utf8'))
  const handed = [...text.matchAll(SHADOWED_PRIMITIVES)]
    .map((match) => `<${match[1]}> ${classStrings(match[2] ?? '').join(' ')}`)
    .filter((value) => value.split(/\s+/).some((t) => NEUTRAL_BORDER.test(t)))
  return [...classStrings(text), ...cnCalls(text)].filter((value) => isDouble(value.split(/\s+/))).concat(handed)
}

describe('a surface draws one edge', () => {
  it('no class string sets a neutral border beside a ringed shadow', () => {
    const offenders = ['app', 'ui', 'shared']
      .flatMap(sourceFiles)
      .flatMap((file) => doubles(file).map((value) => `${file}: ${value.slice(0, 120)}`))
    expect(offenders).toEqual([])
  })

  it('the shared surfaces take their edge from the shadow alone', () => {
    for (const file of ['card', 'popover', 'dropdown-menu', 'context-menu', 'select', 'dialog', 'sonner']) {
      expect(doubles(`ui/components/ui/${file}.tsx`), file).toEqual([])
    }
  })

  it('the tokens still draw the ring, which is why the border has to go', () => {
    const tokens = readFileSync(join(ROOT, 'ui/styles/tokens.css'), 'utf8')
    expect(tokens).toMatch(/--elevation-xs: 0 0 0 1px var\(--edge\)/)
    expect(tokens).toMatch(/--elevation-1: 0 0 0 1px var\(--edge\)/)
  })
})
