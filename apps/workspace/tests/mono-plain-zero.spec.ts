// @disk-inputs: app/**, ui/**
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import * as fontkit from 'fontkit'
import postcss, { type Root } from 'postcss'
import { describe, expect, it } from 'vitest'
import { callsTo, importsOf, parseSource, productionSources, ts } from '@/test-utils/source-ast'
import { srcEntries, srcPath } from '@/test-utils/source-tree'

const ROOT = join(__dirname, '..')
const MONO_VARIABLE = '--font-geist-mono'
const MONO_FEATURES = '--font-mono--font-feature-settings'

const stylesheet = (path: string): Root => postcss.parse(readFileSync(join(ROOT, path), 'utf8'))

function propertyNamed(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  const property = object.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate) && (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) && candidate.name.text === name,
  )
  return property?.initializer
}

function monoLoader(): { path: string; src: string } | undefined {
  for (const path of productionSources()) {
    for (const call of callsTo(parseSource(path), 'localFont')) {
      const options = call.arguments[0]
      if (!options || !ts.isObjectLiteralExpression(options)) continue
      const variable = propertyNamed(options, 'variable')
      const src = propertyNamed(options, 'src')
      if (variable && ts.isStringLiteral(variable) && variable.text === MONO_VARIABLE && src && ts.isStringLiteral(src)) {
        return { path, src: src.text }
      }
    }
  }
  return undefined
}

function monoFeatures(): string[] {
  let value: string | undefined
  stylesheet('ui/styles/tokens.css').walkDecls(MONO_FEATURES, (declaration) => {
    value = declaration.value
  })
  expect(value, 'tokens.css declares --font-mono--font-feature-settings').toBeDefined()
  return [...(value ?? '').matchAll(/['"]([a-z0-9]{4})['"](?:\s+(?:on|1))?/g)].map((tag) => tag[1]!)
}

function monoFontFile(): string {
  const loader = monoLoader()
  expect(loader, `a file loads ${MONO_VARIABLE} with next/font/local`).toBeDefined()
  return resolve(dirname(join(ROOT, loader?.path ?? '')), loader?.src ?? '')
}

function contours(font: fontkit.Font, text: string, features: string[]): number {
  const [glyph] = font.layout(text, features).glyphs
  return glyph.path.commands.filter((command) => command.command === 'closePath').length
}

// The text a source file carries as values: string literals and template parts, never comments or identifiers.
function textsOf(root: ts.Node): string[] {
  const texts: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) texts.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(root)
  return texts
}

const MONO_NAMED = 'var(--font-mono)'

const namesMonoByHand = (texts: string[]): boolean =>
  texts.some((text) => text.includes(MONO_NAMED)) && !texts.some((text) => text.includes(MONO_FEATURES))

const stylesheetTexts = (root: Root): string[] => {
  const texts: string[] = []
  root.walk((node) => {
    if (node.type === 'decl') texts.push(node.prop, node.value)
  })
  return texts
}

describe('the mono face draws a plain zero', () => {
  it('is loaded from the full font, not the Google Fonts subset', () => {
    const loader = monoLoader()
    expect(loader, `a file loads ${MONO_VARIABLE} with next/font/local`).toBeDefined()
    expect(importsOf(parseSource(loader?.path ?? '')).map((edge) => edge.specifier)).not.toContain('next/font/google')
  })

  it('draws 0 without a slash under the features tokens.css switches on', () => {
    const features = monoFeatures()
    const font = fontkit.openSync(monoFontFile())
    if (!('layout' in font)) throw new Error('the mono font file is a collection, not one face')

    expect(features.every((tag) => font.availableFeatures.includes(tag))).toBe(true)
    expect(contours(font, 'O', features), 'the plain ring the 0 is compared with').toBe(2)
    expect(contours(font, '0', features)).toBe(2)
  })

  it('sets the feature wherever code names the mono family by hand', () => {
    const inTree = (path: string): boolean => path.startsWith('app/') || path.startsWith('ui/')
    const offenders = [
      ...productionSources()
        .filter(inTree)
        .filter((path) => namesMonoByHand(textsOf(parseSource(path))))
        .map((path) => path),
      ...srcEntries()
        .filter((key) => key.split('.').pop() === 'css')
        .map((key) => relative(process.cwd(), srcPath(key)).replace(/\\/g, '/'))
        .filter(inTree)
        .filter((path) => path !== 'ui/styles/tokens.css')
        .filter((path) => namesMonoByHand(stylesheetTexts(postcss.parse(readFileSync(join(ROOT, path), 'utf8'))))),
    ]

    expect(
      offenders,
      'use `font-mono`, or set font-feature-settings: var(--font-mono--font-feature-settings)'
    ).toEqual([])
  })
})
