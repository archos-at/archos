// @disk-inputs: app/**, ui/**
/**
 * The pointer's fill is one step down the ladder from the plane it lies on
 * (docs/design/design-language.md, „Hover is one step down the ladder“).
 *
 * Until 2026-11 a hover named a grey by hand, and Paper on a desk moved the
 * greys under the names: `hover:bg-accent` became the picked grey, two steps
 * down, `hover:bg-muted` and `hover:bg-secondary` the desk, `hover:bg-card`
 * white (nothing on a sheet, lighter than the paper), and a dozen `/40` to
 * `/60` steps lay between them. Measured on eight previews, a row or a ghost
 * on a sheet took one of five fills, and a file row's ⋯ took the desk on the
 * row's own desk: no hover at all.
 *
 * Now a hover is one of two things, and each end is held here:
 *   - an element with no fill of its own takes the wash (`hover:bg-hover`),
 *     which is one step on any plane because the ladder's steps are one wash
 *     apart. The arithmetic is checked against `tokens.css`, so retuning a
 *     step without the wash fails;
 *   - an element with a fill of its own names its next step (`bg-desk
 *     hover:bg-selected`), or its own fill to hold it under the pointer.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.(spec|test)\./.test(entry.name) ? [path] : []
  })
}

const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** The fill a hover utility sets, or null for a class that sets none: `group-hover/row:bg-desk` → `desk`. */
function hoverFill(utility: string): string | null {
  const variants = utility.split(':')
  const fill = variants.pop() ?? ''
  if (!fill.startsWith('bg-')) return null
  return variants.some((variant) => /^(group-|peer-)?hover(\/[\w-]+)?$/.test(variant)) ? fill.slice('bg-'.length) : null
}

/** The wash, a held or cancelled fill, and the ladder's named steps for an element with a fill of its own. */
const LADDER = new Set(['hover', 'transparent', 'sheet', 'desk', 'selected', 'pressed'])
/** A fill that carries a colour's meaning steps within its own family: ink, the signal colours, the rail's own tokens. */
const OWN_FAMILY = /^(primary|destructive|danger-subtle|interaction-primary-hover|sidebar)(\b|-|\/)/

/** A hover fill outside the ladder on purpose, with the reason. */
const ALLOWED: Record<string, string> = {
  'ui/components/ui/resizable.tsx': 'a 1px divider darkening to ink: a line, not a fill',
  'ui/features/chat/components/AnswerFeedback.tsx': 'the chosen verdict is an ink disc and holds its ink under the pointer',
}

describe('hover is one step down the ladder', () => {
  it('a hover fill is the wash, or a named step of the ladder: never a grey by another name or a fraction of one', () => {
    const offenders = ['app', 'ui']
      .flatMap((dir) => sourceFiles(join(ROOT, dir)))
      .map((file) => ({ name: relative(ROOT, file), text: withoutComments(readFileSync(file, 'utf8')) }))
      .filter((file) => !(file.name in ALLOWED))
      .flatMap((file) =>
        [...new Set(file.text.split(/[\s"'`]+/))]
          .filter((utility) => {
            const fill = hoverFill(utility)
            return fill !== null && !LADDER.has(fill) && !OWN_FAMILY.test(fill)
          })
          .map((utility) => `${file.name}: ${utility}`)
      )
    expect(offenders).toEqual([])
  })

  it('every exception still has its hover', () => {
    for (const name of Object.keys(ALLOWED)) {
      const utilities = withoutComments(readFileSync(join(ROOT, name), 'utf8')).split(/[\s"'`]+/)
      expect(utilities.some((utility) => hoverFill(utility) !== null), name).toBe(true)
    }
  })

  it('one wash is one step: on a sheet the desk, on the desk the picked grey, on a picked row the pressed grey', () => {
    const tokens = readFileSync(join(ROOT, 'ui/styles/tokens.css'), 'utf8')
    const light = tokens.slice(tokens.indexOf('--sheet: #ffffff'), tokens.indexOf('.dark {', tokens.indexOf('--sheet: #ffffff')))
    const hex = (name: string): number[] => {
      const value = light.match(new RegExp(`--${name}: #([0-9a-f]{6});`))?.[1]
      expect(value, name).toBeDefined()
      return [0, 2, 4].map((at) => parseInt((value ?? '').slice(at, at + 2), 16))
    }
    const wash = light.match(/--hover: rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\);/)
    expect(wash, 'the light --hover is an ink wash').not.toBeNull()
    const [red, green, blue, alpha] = (wash ?? []).slice(1).map(Number)
    const washed = (plane: number[]): number[] => plane.map((channel, at) => channel + ([red, green, blue][at] - channel) * alpha)
    for (const [plane, step] of [['sheet', 'desk'], ['desk', 'selected'], ['selected', 'pressed']]) {
      washed(hex(plane)).forEach((channel, at) => expect(Math.abs(channel - hex(step)[at]), `${plane} under the pointer is ${step}`).toBeLessThanOrEqual(2))
    }
    // Dark is a white wash one step up, the dark press's own.
    expect(tokens).toMatch(/\.dark \{[^}]*--hover: rgb\(245 244 242 \/ 0\.06\);/)
  })

  it('the kit hovers by the wash: a ghost, an outline, a row, a table row and a menu item', () => {
    const kit = (name: string): string => withoutComments(readFileSync(join(ROOT, 'ui/components/ui', name), 'utf8'))
    expect(kit('button.tsx')).toMatch(/ghost: 'hover:bg-hover /)
    expect(kit('button.tsx')).toMatch(/'border border-input bg-transparent hover:bg-hover /)
    expect(kit('item.tsx')).toMatch(/ hover:bg-hover /)
    expect(kit('table.tsx')).toMatch(/hover:bg-hover data-\[state=selected\]:bg-selected/)
    for (const menu of ['dropdown-menu.tsx', 'context-menu.tsx', 'select.tsx']) expect(kit(menu), menu).toMatch(/focus:bg-hover /)
    expect(kit('command.tsx')).toMatch(/data-\[selected=true\]:bg-hover /)
  })
})
