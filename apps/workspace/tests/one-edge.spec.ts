// @disk-inputs: app/**, ui/**, shared/**
/**
 * A surface draws one edge.
 *
 * Since Paper on a desk (#1526) every elevation token carries its own 1px ring
 * (`--elevation-xs/sm/md/lg` in `ui/styles/tokens.css`: `0 0 0 1px var(--edge)`
 * before the drop shadow). An element that also kept its `border` drew two
 * lines, an 8% border inside and a 12% ring outside it: every Card, menu,
 * popover, dialog and toast in the app, and about fifty hand-rolled panels
 * (owner feedback 2026-11-11, „die doppelten Ränder“).
 *
 * The rule (design-language.md, „One edge“): a surface takes its edge from its
 * shadow and sets no border; a control whose border is its boundary (a radio,
 * a key cap, a toggle, a field), or a border that carries meaning (a colour, a
 * dash), keeps the border and takes no ringed shadow. Read from disk, because
 * the defect is one class added beside another without seeing what the token
 * already draws: in one string, across the strings of one `cn(…)`, or as a
 * `border` handed to a primitive that draws the shadow itself.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')

/** Every shadow utility whose token starts with the ring (`ui/styles/tokens.css`; `2xs` is the ring alone). */
const RINGED_SHADOW = /^(?:[a-z-]+:|data-\[[^\]]+\]:)*shadow(?:-(?:2xs|xs|sm|md|lg|xl|sheet))?$/
/** A border on all four sides in the neutral colour: the second line. A colour, a dash or `border-0` is not it. */
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

/** The class strings of a file: every quoted literal that holds at least one space-separated utility. */
function classStrings(text: string): string[] {
  return [...text.matchAll(/(['"`])((?:(?!\1)[^\n])*)\1/g)].map((match) => match[2] ?? '')
}

const isDouble = (tokens: string[]): boolean =>
  tokens.some((t) => NEUTRAL_BORDER.test(t)) && tokens.some((t) => RINGED_SHADOW.test(t))

/** A literal that sets its own border and `shadow-none` is a state that trades the ring for a line on purpose
 *  (a dashed placeholder, a pending node): it draws one edge whatever the base string says. */
const tradesRingForBorder = (value: string): boolean => {
  const tokens = value.split(/\s+/)
  return tokens.includes('shadow-none') && tokens.some((t) => NEUTRAL_BORDER.test(t))
}

/** The literals of each `cn(…)` call, joined: a class list is often built from several strings. */
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

/** The shared surfaces whose own class draws a ringed shadow: a `border` handed to one of them is a second line. */
const SHADOWED_PRIMITIVES = /<(Card|PopoverContent|DropdownMenuContent|DropdownMenuSubContent|ContextMenuContent|ContextMenuSubContent|SelectContent|DialogContent)\b([^>]*?)>/g

/** Comments read as prose, and an apostrophe in one („the group's border“) opens a string that is no class. */
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
    // The seven primitives most of the app is made of; each was `border … shadow-*` until 2026-11-11.
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
