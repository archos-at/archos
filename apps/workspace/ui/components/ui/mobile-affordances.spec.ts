// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postcss, { type Root, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'
import { calleeName, nodesOf, parseSource, productionSources, ts, walk } from '@/test-utils/source-ast'
import { srcEntries, srcJoin, srcPath } from '@/test-utils/source-tree'

const CLASS_SEPARATORS = [' ', '\t', '\n', '\r']
const VALUE_SEPARATORS = [...CLASS_SEPARATORS, '!', '/', ':', '[', ']', '(', ')', ',', ';', '{', '}', '"', "'", '`', '=', '+', '*']
const VIEWPORT_SEPARATORS = [...VALUE_SEPARATORS, '-']
const SCREEN_HEIGHTS = new Set(['h-screen', 'min-h-screen', 'max-h-screen'])
const EXEMPT_TYPES = new Set(['file', 'range', 'checkbox', 'radio', 'hidden'])
const BREAKPOINTS = new Set(['sm', 'md', 'lg', 'xl', '2xl'])
const FLOOR_UTILITIES = new Set(['text-xs', 'text-sm'])

const splitBy = (text: string, separators: readonly string[]): string[] =>
  separators
    .reduce<string[]>((parts, separator) => parts.flatMap((part) => part.split(separator)), [text])
    .filter((part) => part !== '')

const textsOf = (root: ts.Node): string[] => {
  const texts: string[] = []
  walk(root, (node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      texts.push(node.text)
    }
  })
  return texts
}

const classTokensOf = (root: ts.Node): string[] => textsOf(root).flatMap((text) => splitBy(text, CLASS_SEPARATORS))

const variantsOf = (token: string): string[] => token.split(':').slice(0, -1)

const utilityOf = (token: string): string => {
  const base = token.split(':').at(-1)?.split('/')[0] ?? ''
  return base.startsWith('!') ? base.slice(1) : base
}

const isBreakpointVariant = (variant: string): boolean => BREAKPOINTS.has(variant.split('-').at(-1) ?? '')

const pixelFloor = (utility: string): boolean => {
  if (!utility.startsWith('text-[') || !utility.endsWith('px]')) return false
  const px = Number(utility.slice('text-['.length, -'px]'.length))
  return px >= 10 && px < 16
}

const isFloorText = (utility: string): boolean => FLOOR_UTILITIES.has(utility) || pixelFloor(utility)

const isBreakpointShrink = (token: string): boolean => {
  const nearest = variantsOf(token).at(-1)
  return nearest !== undefined && isBreakpointVariant(nearest) && isFloorText(utilityOf(token))
}

const isViewportHeight = (atom: string): boolean =>
  atom.endsWith('vh') && atom.length > 2 && Number.isFinite(Number(atom.slice(0, -2)))

const viewportHeightAtoms = (text: string): string[] => splitBy(text, VIEWPORT_SEPARATORS).filter(isViewportHeight)

const screenHeightAtoms = (text: string): string[] => splitBy(text, VALUE_SEPARATORS).filter((atom) => SCREEN_HEIGHTS.has(atom))

const inspectSources = (paths: string[], inspect: (file: ts.SourceFile) => string[]): string[] =>
  paths.flatMap((path) => inspect(parseSource(path)).map((finding) => `${path}: ${finding}`))

type ElementNode = ts.JsxOpeningElement | ts.JsxSelfClosingElement

const isElement = (node: ts.Node): node is ElementNode => ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)

const elementsNamed = (file: ts.SourceFile, tags: readonly string[]): ElementNode[] =>
  nodesOf(file, isElement).filter((element) => tags.includes(element.tagName.getText()))

const attributeOf = (element: ElementNode, name: string): ts.JsxAttribute | undefined =>
  element.attributes.properties.find(
    (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText() === name,
  )

const classRegions = (file: ts.SourceFile): string[][] => {
  const regions: string[][] = []
  walk(file, (node) => {
    if (ts.isCallExpression(node) && calleeName(node) === 'cn') regions.push(classTokensOf(node))
    if (ts.isJsxAttribute(node) && node.name.getText() === 'className' && node.initializer) {
      regions.push(classTokensOf(node.initializer))
    }
  })
  return regions
}

const exemptField = (element: ElementNode): boolean => {
  const type = attributeOf(element, 'type')?.initializer
  const className = attributeOf(element, 'className')?.initializer
  return (
    (type !== undefined && textsOf(type).some((text) => EXEMPT_TYPES.has(text))) ||
    (className !== undefined &&
      ts.isStringLiteral(className) &&
      classTokensOf(className).some((token) => token === 'sr-only' || token === 'hidden'))
  )
}

const cssValues = (root: Root): string[] => {
  const values: string[] = []
  root.walk((node) => {
    if (node.type === 'decl') values.push(node.value)
    else if (node.type === 'rule') values.push(node.selector)
    else if (node.type === 'atrule') values.push(node.params)
  })
  return values
}

const rulesWithSelectors = (root: Root, selectors: readonly string[]): Rule[] => {
  const rules: Rule[] = []
  root.walkRules((rule) => {
    if (selectors.every((selector) => rule.selectors.includes(selector))) rules.push(rule)
  })
  return rules
}

const declarationValues = (rule: Rule, prop: string): string[] => {
  const values: string[] = []
  rule.walkDecls(prop, (declaration) => {
    values.push(declaration.value)
  })
  return values
}

const layeredRules = (root: Root): Set<Rule> => {
  const layered = new Set<Rule>()
  root.walkAtRules('layer', (layer) => {
    layer.walkRules((rule) => {
      layered.add(rule)
    })
  })
  return layered
}

describe('a hover reveal always has a second way in', () => {
  it('never hides a control behind hover alone', () => {
    const offenders = inspectSources(productionSources(), (file) =>
      classRegions(file)
        .filter(
          (tokens) =>
            tokens.includes('group-hover:opacity-100') &&
            tokens.includes('opacity-0') &&
            !tokens.includes('pointer-coarse:opacity-100') &&
            !tokens.includes('md:opacity-0'),
        )
        .map((tokens) => tokens.join(' ').slice(0, 100)),
    )
    expect(offenders, 'A control hidden until hover also needs pointer-coarse:opacity-100, or a touch screen never shows it.').toEqual([])
  })

  it('never hides a control at rest on a screen that has no hover (a touch tablet past md)', () => {
    const offenders = inspectSources(productionSources(), (file) =>
      classRegions(file)
        .filter((tokens) => tokens.includes('md:opacity-0') && !tokens.includes('pointer-coarse:opacity-100'))
        .map((tokens) => tokens.join(' ').slice(0, 100)),
    )
    expect(offenders, 'A control hidden at md needs pointer-coarse:opacity-100 to show on a touch tablet.').toEqual([])
  })
})

describe('no height is measured against the large viewport', () => {
  it('sizes nothing in vh', () => {
    const offenders = inspectSources(
      productionSources().filter((path) => !path.startsWith('app/dev/')),
      (file) => textsOf(file).flatMap((text) => [...viewportHeightAtoms(text), ...screenHeightAtoms(text)]),
    )
    expect(offenders, 'Size with dvh, svh or a container unit: vh and h-screen are the large viewport, taller than a phone shows.').toEqual([])
  })

  it('holds every stylesheet to the same rule', () => {
    const offenders = srcEntries()
      .filter((key) => key.endsWith('.css'))
      .flatMap((key) =>
        cssValues(postcss.parse(readFileSync(srcPath(key), 'utf8'))).flatMap((value) =>
          viewportHeightAtoms(value).map((atom) => `${key}: ${atom}`),
        ),
      )
    expect(offenders, 'Size the stylesheet with dvh, svh or a container unit, not vh.').toEqual([])
  })
})

describe('no text field invites the iOS zoom', () => {
  it('gives every hand-written field a 16px floor where a soft keyboard is likely', () => {
    const offenders = inspectSources(productionSources(), (file) =>
      elementsNamed(file, ['input', 'textarea'])
        .filter((element) => !exemptField(element))
        .map(classTokensOf)
        .filter((tokens) => !tokens.includes('pointer-coarse:text-base') && tokens.some((token) => isFloorText(utilityOf(token))))
        .map((tokens) => tokens.filter((token) => isFloorText(utilityOf(token))).join(' ')),
    )
    expect(offenders, 'A text field below 16px zooms the iOS page: add pointer-coarse:text-base.').toEqual([])
  })

  it('never rebuilds the floor out of a viewport breakpoint', () => {
    const offenders = inspectSources(productionSources(), (file) =>
      elementsNamed(file, ['input', 'textarea'])
        .filter((element) => !exemptField(element))
        .flatMap(classTokensOf)
        .filter(isBreakpointShrink),
    )
    expect(offenders, 'A breakpoint must not shrink a text field below 16px: keep the floor at every width.').toEqual([])
  })
})

describe('a dialog footer is pinned by the primitive, not by hand', () => {
  it('no DialogFooter carries its own sticky', () => {
    const offenders = inspectSources(productionSources(), (file) =>
      elementsNamed(file, ['DialogFooter'])
        .filter((element) => {
          const className = attributeOf(element, 'className')?.initializer
          return className !== undefined && classTokensOf(className).some((token) => utilityOf(token) === 'sticky')
        })
        .map(() => 'DialogFooter sets its own sticky'),
    )
    expect(offenders, 'The dialog primitive pins its footer: remove the sticky from the DialogFooter className.').toEqual([])
  })
})

const globals = postcss.parse(readFileSync(srcJoin('app', 'globals.css'), 'utf8'))

describe('a focus ring is for the keyboard', () => {
  it('keeps the global :focus-visible outline unlayered, so outline-none cannot drop it', () => {
    const layered = layeredRules(globals)
    const rings = rulesWithSelectors(globals, [':focus-visible']).filter((rule) =>
      declarationValues(rule, 'outline').includes('2px solid var(--ring)'),
    )
    expect(rings.map((rule) => layered.has(rule))).toEqual([false])
  })

  it('draws no frame around an overlay panel that holds the focus itself, nor inside a cmdk field', () => {
    const frames = rulesWithSelectors(globals, [
      ":is([role='dialog'], [role='alertdialog']):focus-visible",
      '[cmdk-input]:focus-visible',
    ])
    expect(frames.flatMap((rule) => declarationValues(rule, 'outline'))).toEqual(['none'])
  })
})

describe('no library stylesheet keeps the page scroll', () => {
  it('globals.css carries the rule the class refers to', () => {
    const overrides = rulesWithSelectors(globals, ['.reasoning-flow-scrollable .react-flow__pane'])
    expect(overrides.flatMap((rule) => declarationValues(rule, 'touch-action'))).toEqual(['auto'])
  })

  it('React Flow still ships the default this exists to undo', () => {
    const upstream = postcss.parse(
      readFileSync(join(process.cwd(), 'node_modules', '@xyflow', 'react', 'dist', 'style.css'), 'utf8'),
    )
    const defaults = rulesWithSelectors(upstream, ['.react-flow__pane'])
    expect(defaults.flatMap((rule) => declarationValues(rule, 'touch-action'))).toEqual(['none'])
  })
})
