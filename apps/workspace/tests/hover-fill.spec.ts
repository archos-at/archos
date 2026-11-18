// @disk-inputs: app/**, ui/**
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postcss, { type Rule, type Root } from 'postcss'
import { describe, expect, it } from 'vitest'
import { exportedNames, parseSource, productionSources, ts } from '@/test-utils/source-ast'

const CLASS_SEPARATORS = [' ', '\t', '\n', '\r']
const inTree = (path: string): boolean => path.startsWith('app/') || path.startsWith('ui/')

const exporters = new Map<string, string[]>()
const parsed = new Map<string, ts.SourceFile>()

function sourceOf(path: string): ts.SourceFile {
  let file = parsed.get(path)
  if (!file) {
    file = parseSource(path)
    parsed.set(path, file)
  }
  return file
}

function declaredExports(file: ts.SourceFile): string[] {
  const values = file.statements.flatMap((statement) => {
    if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []))
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) return [statement.name.text]
    return []
  })
  return exportedNames(file).filter((name) => values.includes(name))
}

function moduleExporting(name: string): string {
  if (exporters.size === 0) {
    for (const path of productionSources()) {
      for (const exported of declaredExports(sourceOf(path))) exporters.set(exported, [...(exporters.get(exported) ?? []), path])
    }
  }
  const paths = exporters.get(name) ?? []
  expect(paths, `one module exports ${name}`).toHaveLength(1)
  return paths[0] ?? ''
}

const textsOf = (root: ts.Node): string[] => {
  const texts: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) texts.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return texts
}

const splitBy = (text: string, separators: readonly string[]): string[] =>
  separators
    .reduce<string[]>((parts, separator) => parts.flatMap((part) => part.split(separator)), [text])
    .filter((part) => part !== '')

const classRunsOf = (text: string): string[] => splitBy(text, CLASS_SEPARATORS)

const classRuns = (path: string): string[][] => textsOf(sourceOf(path)).map(classRunsOf)

const classesOf = (path: string): string[] => classRuns(path).flat()

const hasRun = (path: string, run: readonly string[]): boolean =>
  classRuns(path).some((tokens) =>
    tokens.some((_, start) => run.every((name, offset) => tokens[start + offset] === name)),
  )

const isHoverVariant = (variant: string): boolean => {
  const [name, ...group] = variant.split('/')
  return ['hover', 'group-hover', 'peer-hover'].includes(name ?? '') && (group.length === 0 || (group.length === 1 && group[0] !== ''))
}

function hoverFill(utility: string): string | null {
  const variants = utility.split(':')
  const fill = variants.pop() ?? ''
  if (!fill.startsWith('bg-')) return null
  return variants.some(isHoverVariant) ? fill.slice('bg-'.length) : null
}

const isWordCharacter = (character: string): boolean =>
  character.toLowerCase() !== character.toUpperCase() || (character >= '0' && character <= '9') || character === '_'

const LADDER = new Set(['hover', 'transparent', 'sheet', 'sheet-hover', 'desk', 'selected', 'pressed'])
const OWN_FAMILY = ['primary', 'destructive', 'danger-subtle', 'interaction-primary-hover', 'sidebar']

const ownFamily = (fill: string): boolean =>
  OWN_FAMILY.some((family) => fill.startsWith(family) && (fill.length === family.length || !isWordCharacter(fill.charAt(family.length))))

const ALLOWED: Record<string, string> = {
  ResizableHandle: 'a 1px divider darkening to ink: a line, not a fill',
  AnswerFeedback: 'the chosen verdict is an ink disc and holds its ink under the pointer',
  Switch: 'an off switch is a track of ink at 12%, not a plane: it steps to 20%',
}

const exempt = (): Set<string> => new Set(Object.keys(ALLOWED).map(moduleExporting))

function paperBlock(root: Root, selector: ':root' | '.dark'): Map<string, string> {
  const rule = root.nodes.find(
    (node): node is Rule => node.type === 'rule' && node.selector === selector && node.nodes.some((child) => child.type === 'decl' && child.prop === '--sheet'),
  )
  const values = new Map<string, string>()
  rule?.each((child) => {
    if (child.type === 'decl') values.set(child.prop, child.value)
  })
  return values
}

const tokens = postcss.parse(readFileSync(join(process.cwd(), 'ui/styles/tokens.css'), 'utf8'))

describe('hover is one step down the ladder', () => {
  it('a hover fill is the wash, or a named step of the ladder: never a grey by another name or a fraction of one', () => {
    const exceptions = exempt()
    const offenders = productionSources()
      .filter(inTree)
      .filter((path) => !exceptions.has(path))
      .flatMap((path) =>
        [...new Set(classesOf(path))]
          .filter((utility) => {
            const fill = hoverFill(utility)
            return fill !== null && !LADDER.has(fill) && !ownFamily(fill)
          })
          .map((utility) => `${path}: ${utility}`),
      )
    expect(offenders).toEqual([])
  })

  it('every exception still has its hover', () => {
    for (const name of Object.keys(ALLOWED)) {
      expect(classesOf(moduleExporting(name)).some((utility) => hoverFill(utility) !== null), name).toBe(true)
    }
  })

  it('one wash is one step: on a sheet the desk, on the desk the picked grey, on a picked row the pressed grey', () => {
    const light = paperBlock(tokens, ':root')
    const dark = paperBlock(tokens, '.dark')
    const hex = (name: string): number[] => {
      const value = light.get(`--${name}`)?.match(/^#([0-9a-f]{6})$/)?.[1]
      expect(value, name).toBeDefined()
      return [0, 2, 4].map((at) => parseInt((value ?? '').slice(at, at + 2), 16))
    }
    const wash = light.get('--hover')?.match(/^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/)
    expect(wash, 'the light --hover is an ink wash').not.toBeNull()
    const [red, green, blue, alpha] = (wash ?? []).slice(1).map(Number)
    const washed = (plane: number[]): number[] => plane.map((channel, at) => channel + ([red, green, blue][at] - channel) * alpha)
    for (const [plane, step] of [['sheet', 'desk'], ['desk', 'selected'], ['selected', 'pressed']]) {
      washed(hex(plane)).forEach((channel, at) => expect(Math.abs(channel - hex(step)[at]), `${plane} under the pointer is ${step}`).toBeLessThanOrEqual(2))
    }
    expect(dark.get('--hover')).toBe('rgb(245 244 242 / 0.06)')
    expect(light.get('--sheet-hover')).toBe(`color-mix(in srgb, var(--sheet) ${100 - alpha * 100}%, rgb(${red} ${green} ${blue}))`)
    expect(dark.get('--sheet-hover')).toBe('color-mix(in srgb, var(--sheet) 94%, rgb(245 244 242))')
  })

  it('a folder and a file tile answer the pointer with their own sheet, and nothing is laid behind it', () => {
    const folder = moduleExporting('FolderCardFrame')
    const tile = moduleExporting('FileTileBody')
    const cnCalls = (path: string) => {
      const calls: ts.CallExpression[] = []
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'cn') calls.push(node)
        ts.forEachChild(node, visit)
      }
      visit(sourceOf(path))
      return calls
    }
    const sheetCalls = cnCalls(folder).filter((call) => ts.isIdentifier(call.arguments[0] as ts.Node) && (call.arguments[0] as ts.Identifier).text === 'FOLDER_SHEET')
    expect(
      sheetCalls.some((call) => call.arguments.some((argument) => ts.isStringLiteral(argument) && classRunsOf(argument.text).includes('group-hover:bg-sheet-hover'))),
    ).toBe(true)
    expect(classesOf(tile).some((utility) => utility.includes('hover:bg-'))).toBe(false)
    expect(classesOf(tile)).toContain('group-hover/tile:shadow-sheet-pointer')
  })

  it('the kit hovers by the wash: a ghost, a row, a table row and a menu item; the white press by the sheet’s own step', () => {
    const button = moduleExporting('buttonVariants')
    const properties = (path: string, name: string): string[] => {
      const values: string[] = []
      const visit = (node: ts.Node): void => {
        if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === name && ts.isStringLiteral(node.initializer)) {
          values.push(node.initializer.text)
        }
        ts.forEachChild(node, visit)
      }
      visit(sourceOf(path))
      return values
    }
    expect(properties(button, 'ghost').some((value) => value.startsWith('hover:bg-hover '))).toBe(true)
    expect(properties(button, 'secondary').some((value) => value.startsWith('bg-sheet text-foreground shadow-press hover:bg-sheet-hover '))).toBe(true)
    expect(properties(button, 'outline')).toEqual([])
    expect(classesOf(moduleExporting('ItemMedia')).includes('hover:bg-hover')).toBe(true)
    expect(hasRun(moduleExporting('TableRow'), ['hover:bg-hover', 'data-[state=selected]:bg-selected'])).toBe(true)
    for (const menu of ['DropdownMenuItem', 'ContextMenuItem', 'SelectItem']) {
      expect(classesOf(moduleExporting(menu)), menu).toContain('focus:bg-hover')
    }
    expect(classesOf(moduleExporting('CommandItem'))).toContain('data-[selected=true]:bg-hover')
  })
})
