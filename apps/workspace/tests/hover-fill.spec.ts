// @disk-inputs: app/**, ui/**
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

function hoverFill(utility: string): string | null {
  const variants = utility.split(':')
  const fill = variants.pop() ?? ''
  if (!fill.startsWith('bg-')) return null
  return variants.some((variant) => /^(group-|peer-)?hover(\/[\w-]+)?$/.test(variant)) ? fill.slice('bg-'.length) : null
}

const LADDER = new Set(['hover', 'transparent', 'sheet', 'sheet-hover', 'desk', 'selected', 'pressed'])
const OWN_FAMILY = /^(primary|destructive|danger-subtle|interaction-primary-hover|sidebar)(\b|-|\/)/

const ALLOWED: Record<string, string> = {
  'ui/components/ui/resizable.tsx': 'a 1px divider darkening to ink: a line, not a fill',
  'ui/features/chat/components/AnswerFeedback.tsx': 'the chosen verdict is an ink disc and holds its ink under the pointer',
  'ui/components/ui/switch.tsx': 'an off switch is a track of ink at 12%, not a plane: it steps to 20%',
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
    expect(tokens).toMatch(/\.dark \{[^}]*--hover: rgb\(245 244 242 \/ 0\.06\);/)
    expect(light).toContain(`--sheet-hover: color-mix(in srgb, var(--sheet) ${100 - alpha * 100}%, rgb(${red} ${green} ${blue}));`)
    expect(tokens).toMatch(/\.dark \{[^}]*--sheet-hover: color-mix\(in srgb, var\(--sheet\) 94%, rgb\(245 244 242\)\);/)
  })

  it('a folder and a file tile answer the pointer with their own sheet, and nothing is laid behind it', () => {
    const documents = (name: string): string => withoutComments(readFileSync(join(ROOT, 'ui/features/documents/components', name), 'utf8'))
    expect(documents('folder-card-frame.tsx')).toMatch(/cn\(FOLDER_SHEET, '[^']*group-hover:bg-sheet-hover /)
    expect(documents('file-tile.tsx')).not.toMatch(/hover:bg-/)
    expect(documents('file-tile.tsx')).toMatch(/group-hover\/tile:shadow-sheet-pointer/)
  })

  it('the kit hovers by the wash: a ghost, a row, a table row and a menu item; the white press by the sheet’s own step', () => {
    const kit = (name: string): string => withoutComments(readFileSync(join(ROOT, 'ui/components/ui', name), 'utf8'))
    expect(kit('button.tsx')).toMatch(/ghost: 'hover:bg-hover /)
    expect(kit('button.tsx')).toMatch(/secondary:\s*'bg-sheet text-foreground shadow-press hover:bg-sheet-hover /)
    expect(kit('button.tsx')).not.toMatch(/\boutline:\s*'/)
    expect(kit('item.tsx')).toMatch(/ hover:bg-hover /)
    expect(kit('table.tsx')).toMatch(/hover:bg-hover data-\[state=selected\]:bg-selected/)
    for (const menu of ['dropdown-menu.tsx', 'context-menu.tsx', 'select.tsx']) expect(kit(menu), menu).toMatch(/focus:bg-hover /)
    expect(kit('command.tsx')).toMatch(/data-\[selected=true\]:bg-hover /)
  })
})
