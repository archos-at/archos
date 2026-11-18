/**
 * @vitest-environment node
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { nodesOf, parseSource, productionSources, ts } from '@/test-utils/source-ast'

const ROOT = process.cwd()

const REMOVED: Record<string, string> = {
  'bff/oib': 'the law at the site from the records, `bff/base-knowledge/context/project-law.ts`',
  'bff/base-knowledge/platform/applicability.ts': 'the competence rulesets, `directiveVerdict` in `bff/base-knowledge/platform.ts`',
  'ui/features/projects/components/applicable-standards.tsx': 'the Steckbrief card, `ui/features/project-intake/components/profile/rules-card.tsx`',
  'ui/features/projects/components/standard-chips.tsx': 'the role dots of the Steckbrief card',
  'app/api/projects/[id]/standards': '`project-base-get`, whose `law` names the editions',
}

const OLD_NAMES = ['getApplicableStandards', 'deriveProjectStandards', 'OIB_STANDARDS', 'platformDirectiveApplies', 'project-standards-get', 'AUSTRIAN_STATES']

const sourceFiles = (): string[] =>
  productionSources(ROOT).filter((path) => /^(app|bff|ui)\//.test(path) && /\.tsx?$/.test(path))

const isNameBearing = (
  node: ts.Node,
): node is ts.Identifier | ts.StringLiteralLike | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail =>
  ts.isIdentifier(node) ||
  ts.isStringLiteralLike(node) ||
  ts.isTemplateHead(node) ||
  ts.isTemplateMiddle(node) ||
  ts.isTemplateTail(node)

const namesInCode = (file: string): string[] => nodesOf(parseSource(file, ROOT), isNameBearing).map((node) => node.text)

const isText = (node: ts.Node | undefined, text: string): boolean =>
  node !== undefined && ts.isStringLiteralLike(node) && node.text === text

const keyOf = (name: ts.PropertyName): string | undefined => (ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined)

function writesLandList(file: string): boolean {
  const source = parseSource(file, ROOT)
  const inArray = nodesOf(source, ts.isArrayLiteralExpression).some(({ elements }) =>
    elements.some((element, index) => isText(element, 'lower_austria') && isText(elements[index + 1], 'upper_austria')),
  )
  const inObject = nodesOf(source, ts.isPropertyAssignment).some((property) => {
    const key = keyOf(property.name)
    const value = property.initializer
    return (
      (key === 'lower_austria' && isText(value, 'AT-3')) ||
      (key === 'AT-3' && ts.isStringLiteralLike(value) && value.text.startsWith('Nieder'))
    )
  })
  return inArray || inObject
}

describe('the cut-over (ADR-0175)', () => {
  it.each(Object.entries(REMOVED))('%s stays removed: %s replaced it', (path) => {
    expect(existsSync(join(ROOT, path))).toBe(false)
  })

  it('no source reads a name of the old paths', () => {
    const found = sourceFiles().flatMap((file) => {
      const names = namesInCode(file)
      return OLD_NAMES.filter((name) => names.some((text) => text.includes(name))).map((name) => `${file}: ${name}`)
    })
    expect(found).toEqual([])
  })

  it('no source writes its own list of Austria’s Länder', () => {
    const found = sourceFiles().filter((file) => writesLandList(file))
    expect(found.filter((file) => !file.startsWith('app/dev/'))).toEqual([])
  })
})
