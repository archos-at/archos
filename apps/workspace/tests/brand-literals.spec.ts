// @disk-inputs: app/**, ui/**, shared/**, i18n/dictionaries/**
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import postcss, { type Declaration, type Root, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'
import { dictionaries } from '@/i18n/dictionaries'
import { calleeName, exportedNames, nodesOf, parseSource, productionSources, ts, walk } from '@/test-utils/source-ast'
import { srcEntries, srcPath } from '@/test-utils/source-tree'

const ROOT = process.cwd()
const TOKENS = 'ui/styles/tokens.css'
const GLOBALS = 'app/globals.css'
const PALETTE = 'ui/styles/data-palette.css'
const BRAND_TOKENS = 'shared/brand/tokens.vars.css'


const inTree = (path: string): boolean =>
  (path.startsWith('app/') || path.startsWith('ui/') || path.startsWith('shared/')) &&
  !path.startsWith('shared/brand/') &&
  !path.split('/').includes('dev')

const tsFiles = (): string[] => productionSources().filter(inTree)

const cssFiles = (): string[] =>
  srcEntries()
    .filter((key) => key.split('.').pop() === 'css')
    .map((key) => relative(ROOT, srcPath(key, ROOT)).replace(/\\/g, '/'))
    .filter(inTree)

const CLASS_SEPARATORS = [' ', '\t', '\n', '\r']
const splitBy = (text: string, separators: readonly string[]): string[] =>
  separators
    .reduce<string[]>((parts, separator) => parts.flatMap((part) => part.split(separator)), [text])
    .filter((part) => part !== '')

const classesOfText = (text: string): string[] => splitBy(text, CLASS_SEPARATORS)

const utilityOf = (token: string): string => {
  const base = token.split(':').at(-1)?.split('/')[0] ?? ''
  return base.startsWith('!') ? base.slice(1) : base
}

const unvaried = (token: string): boolean => !token.includes(':')

const hasRun = (tokens: readonly string[], run: readonly string[]): boolean =>
  tokens.some((_, at) => run.every((name, offset) => tokens[at + offset] === name))


function declaredExports(file: ts.SourceFile): string[] {
  const values = file.statements.flatMap((statement) => {
    if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []))
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) return [statement.name.text]
    return []
  })
  return exportedNames(file).filter((name) => values.includes(name))
}

const tryParse = (path: string): ts.SourceFile | undefined => {
  try {
    return parseSource(path)
  } catch {
    return undefined
  }
}

const exporters = new Map<string, string[]>()

function moduleOf(name: string, within = ''): string {
  if (exporters.size === 0) {
    for (const path of productionSources()) {
      const file = tryParse(path)
      if (file) for (const exported of declaredExports(file)) exporters.set(exported, [...(exporters.get(exported) ?? []), path])
    }
  }
  const paths = (exporters.get(name) ?? []).filter((path) => path.startsWith(within))
  expect(paths, `one module declares ${name}`).toHaveLength(1)
  return paths[0] ?? ''
}

const modulesOf = (...names: string[]): Set<string> => new Set(names.map((name) => moduleOf(name)))

type Summary = { literals: string[]; identifiers: string[] }
const summaries = new Map<string, Summary>()

function summaryOf(path: string): Summary {
  let summary = summaries.get(path)
  if (!summary) {
    const literals: string[] = []
    const identifiers = new Set<string>()
    const file = tryParse(path)
    if (file) {
      walk(file, (node) => {
        if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) literals.push(node.text)
        else if (ts.isIdentifier(node)) identifiers.add(node.text)
      })
    }
    summary = { literals, identifiers: [...identifiers] }
    summaries.set(path, summary)
  }
  return summary
}

const classRunsOf = (path: string): string[][] => summaryOf(path).literals.map(classesOfText)
const classesOf = (path: string): string[] => classRunsOf(path).flat()
const mentions = (path: string, identifier: string): boolean => summaryOf(path).identifiers.includes(identifier)

const literalHasRun = (path: string, run: readonly string[]): boolean => classRunsOf(path).some((tokens) => hasRun(tokens, run))


type Opening = ts.JsxOpeningElement | ts.JsxSelfClosingElement

const tagOf = (element: Opening): string => (ts.isIdentifier(element.tagName) ? element.tagName.text : '')

function elementsNamed(root: ts.Node, tags: readonly string[]): Opening[] {
  return nodesOf(root, (node): node is Opening => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && tags.includes(tagOf(node)))
}

function attributeOf(element: Opening, name: string): ts.JsxAttribute | undefined {
  return element.attributes.properties.find((property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === name)
}

const stringAttribute = (element: Opening, name: string): string | undefined => {
  const initializer = attributeOf(element, name)?.initializer
  return initializer && ts.isStringLiteral(initializer) ? initializer.text : undefined
}

const expressionAttribute = (element: Opening, name: string): ts.Expression | undefined => {
  const initializer = attributeOf(element, name)?.initializer
  return initializer && ts.isJsxExpression(initializer) ? initializer.expression : undefined
}

const shapeOfAttribute = (element: Opening, name: string): string | undefined => {
  const expression = expressionAttribute(element, name)
  return expression === undefined ? undefined : shapeOf(expression)
}

function leavesOf(node: ts.Node): string[] {
  const leaves: string[] = []
  const visit = (current: ts.Node): void => {
    if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) leaves.push(`'${current.text}'`)
    else if (ts.isTemplateHead(current) || ts.isTemplateMiddle(current) || ts.isTemplateTail(current)) leaves.push(`'${current.text}'`)
    else if (ts.isIdentifier(current)) leaves.push(current.text)
    else if (ts.isJsxText(current)) {
      if (current.text.trim() !== '') leaves.push(current.text.trim())
    } else {
      const children = current.getChildren()
      if (children.length > 0) children.forEach(visit)
      else if (current.getText() !== '') leaves.push(current.getText())
    }
  }
  visit(node)
  return leaves
}

const shapeOf = (node: ts.Node): string => leavesOf(node).join(' ')

function hasShape(root: ts.Node, expected: string): boolean {
  return nodesOf(root, (node): node is ts.Node => {
    if (!(ts.isBinaryExpression(node) || ts.isConditionalExpression(node) || ts.isCallExpression(node) || ts.isPrefixUnaryExpression(node) || ts.isPropertyAccessExpression(node) || ts.isParenthesizedExpression(node) || ts.isArrowFunction(node) || ts.isAsExpression(node))) return false
    const shape = shapeOf(node)
    return shape === expected || shape.startsWith(`${expected} `)
  }).length > 0
}

function stringConst(root: ts.Node, name: string): string | undefined {
  const declaration = nodesOf(root, ts.isVariableDeclaration).find((node) => ts.isIdentifier(node.name) && node.name.text === name)
  return declaration?.initializer && ts.isStringLiteral(declaration.initializer) ? declaration.initializer.text : undefined
}


const sheets = new Map<string, Root>()
const sheet = (path: string): Root => {
  let root = sheets.get(path)
  if (!root) {
    root = postcss.parse(readFileSync(join(ROOT, path), 'utf8'))
    sheets.set(path, root)
  }
  return root
}

const valuesOf = (root: Root, prop: string): string[] => {
  const values: string[] = []
  root.walkDecls(prop, (declaration) => {
    values.push(declaration.value)
  })
  return values
}

const declarationsOf = (rule: Rule): Map<string, string> => {
  const values = new Map<string, string>()
  rule.each((node) => {
    if (node.type === 'decl') values.set(node.prop, node.value)
  })
  return values
}

const rulesWith = (root: Root, selector: string): Rule[] => {
  const rules: Rule[] = []
  root.walkRules((rule) => {
    if (rule.selectors.includes(selector)) rules.push(rule)
  })
  return rules
}

function paperLayer(selector: ':root' | '.dark'): Map<string, string> {
  const rule = sheet(TOKENS).nodes.find(
    (node): node is Rule => node.type === 'rule' && node.selector === selector && node.nodes.some((child) => child.type === 'decl' && child.prop === '--sheet'),
  )
  return rule ? declarationsOf(rule) : new Map()
}

const light = (): Map<string, string> => paperLayer(':root')
const dark = (): Map<string, string> => paperLayer('.dark')

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const ratio = (a: string, b: string): number => {
  const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y)
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
}


const DATEIEN_MODULES = modulesOf(
  'ProjectSectionFrame',
  'SectionNav',
  'FileBrowserPane',
  'FileWorkspace',
  'FolderCard',
  'FolderCardFrame',
  'FileTileBody',
  'FileGrid',
  'FileListView',
  'FolderBrief',
  'FilesHeaderControls',
  'OpenMarksChip',
  'usePhoneRootTools',
  'FilePreviewDetailsPanel',
  'PageReadings',
  'FolderReadState',
  'FileName',
  'ReaderHeader',
  'FilePreviewChrome',
  'FileSearchBar',
  'FolderBinPanel',
  'OpenPointsPanel',
  'AgentReading',
  'SemanticMatch',
  'MarkRowContent',
)
DATEIEN_MODULES.add(moduleOf('SelectionBar', 'ui/features/documents/'))
DATEIEN_MODULES.add(moduleOf('FileCard', 'ui/features/documents/'))
const DATEIEN_DIRECTORIES = ['ui/features/inbound-mail/']
const inDateien = (path: string): boolean => DATEIEN_MODULES.has(path) || DATEIEN_DIRECTORIES.some((dir) => path.startsWith(dir))

const AFFORDANCE_MODULES = new Set([
  ...DATEIEN_MODULES,
  ...modulesOf('FileFilterMenu', 'AssignPopover', 'UploadTray', 'FilingBar', 'FilingSuggestionSlot', 'HeldUploadDecision', 'SuggestionNotice', 'DocumentActionsMenu'),
])
const AFFORDANCE_DIRECTORIES = [...DATEIEN_DIRECTORIES, 'ui/features/documents/components/mail-thread/']
const inAffordance = (path: string): boolean => AFFORDANCE_MODULES.has(path) || AFFORDANCE_DIRECTORIES.some((dir) => path.startsWith(dir))


function pressKeyOf(element: Opening): string {
  const scope: ts.Node = elementOf(element) ?? element
  const testId = nodesOf(scope, ts.isJsxAttribute).find((attribute) => ts.isIdentifier(attribute.name) && attribute.name.text === 'data-testid')?.initializer
  if (testId && ts.isStringLiteral(testId)) return testId.text
  if (testId && ts.isJsxExpression(testId) && testId.expression && ts.isNoSubstitutionTemplateLiteral(testId.expression)) return testId.expression.text
  const translated = nodesOf(scope, ts.isCallExpression).find(
    (call) => ts.isIdentifier(call.expression) && /^t[A-Za-z]*$/.test(call.expression.text) && ts.isStringLiteral(call.arguments[0] as ts.Node),
  )
  return translated ? (translated.arguments[0] as ts.StringLiteral).text : 'unnamed'
}

const BOLD_ALLOWED = modulesOf('Logo', 'ReadingMilestoneCard')
const WHITE_ALLOWED = modulesOf('LiveCursor', 'CommentPin', 'PageThumbnailButton', 'SketchFigure', 'QuestionControl', 'ReviewPageLayer', 'MermaidDiagram')
const CAPITALS_ALLOWED = new Set([...modulesOf('Logo', 'FileExtChip', 'FileListView', 'FolderBinPanel', 'DocumentKindThumbnail', 'MessageAuthor', 'AuthorityTag'), moduleOf('FileCard', 'ui/features/documents/')])
const H1_ALLOWED = modulesOf('WelcomeState', 'StatusScreen', 'OrganizationSetup', 'ReadingStep', 'RoundList', 'MarkdownH1')
const LEGAL_DIRECTORY = 'app/legal/[slug]/'

describe('weight', () => {
  it('weights are 440, 500 and 600: nothing is bold or extrabold but the wordmark', () => {
    const offenders = tsFiles()
      .filter((path) => !BOLD_ALLOWED.has(path))
      .filter((path) => classesOf(path).some((token) => ['font-bold', 'font-extrabold', 'font-black'].includes(utilityOf(token))))
    expect(offenders).toEqual([])
  })

  it('the type scale carries a title by size at 500 and the small heading at 600: section 16/600, pane title 18/500, page title 20/500', () => {
    const tokens = sheet(TOKENS)
    for (const [name, size, weight] of [['section', '1rem', '600'], ['pane-title', '1.125rem', '500'], ['page-title', '1.25rem', '500']]) {
      expect(valuesOf(tokens, `--text-${name}`), name).toContain(size)
      expect(valuesOf(tokens, `--text-${name}--font-weight`), name).toContain(weight)
    }
  })

  it('the lightest weight is the raised normal, 440, read by the body and every font-normal', () => {
    expect(valuesOf(sheet(TOKENS), '--font-weight-normal')).toContain('440')
    const body = rulesWith(sheet(GLOBALS), 'body')
    expect(body.some((rule) => declarationsOf(rule).get('font-weight') === 'var(--font-weight-normal)')).toBe(true)
  })

  it('nothing is set lighter than the normal weight (Notion #38)', () => {
    const classes = tsFiles().filter((path) => classesOf(path).some((token) => ['font-thin', 'font-extralight', 'font-light'].includes(utilityOf(token))))
    expect(classes).toEqual([])
    const weights = cssFiles().filter((path) => {
      const values: string[] = []
      sheet(path).walkDecls('font-weight', (declaration) => { values.push(declaration.value.split(' ')[0] ?? '') })
      return values.some((value) => ['normal', 'lighter', '100', '200', '300', '400'].includes(value))
    })
    expect(weights).toEqual([])
  })

  it('the stylesheet sets no weight above 600 outside the wordmark face', () => {
    const offenders = cssFiles().filter((path) => {
      const root = sheet(path)
      const heavy: string[] = []
      root.walkDecls('font-weight', (declaration) => { heavy.push(declaration.value.split(' ')[0] ?? '') })
      const faces: string[] = []
      root.walkAtRules('font-face', () => { faces.push('face') })
      return heavy.some((value) => ['700', '800', '900'].includes(value)) && faces.length === 0
    })
    expect(offenders).toEqual([])
  })
})

describe('page titles', () => {
  const isPageTitle = (element: Opening): boolean => {
    const classes = classesOfAttributes(element)
    return classes.some((token) => token.includes('text-page-title') || token.includes('sr-only')) || nodesOf(element.attributes, ts.isIdentifier).some((id) => id.text === 'PAGE_TITLE_CLASS')
  }
  const h1sOffending = (path: string): boolean => elementsNamed(parseSource(path), ['h1']).some((element) => !isPageTitle(element))

  it('every h1 is set as a page title: one size and one weight across the app', () => {
    const legal = (path: string): boolean => path.startsWith(LEGAL_DIRECTORY)
    const offenders = tsFiles().filter((path) => !H1_ALLOWED.has(path) && !legal(path)).filter(h1sOffending)
    expect(offenders).toEqual([])
  })

  it('the allowlist has no stale entry', () => {
    const stale = [...H1_ALLOWED].filter((path) => !h1sOffending(path))
    const legalOwnTitle = tsFiles().filter((path) => path.startsWith(LEGAL_DIRECTORY)).some(h1sOffending)
    expect(stale).toEqual([])
    expect(legalOwnTitle, 'a legal document keeps its own title').toBe(true)
  })
})

describe('white', () => {
  it('text-white and bg-white stay in the allowlist', () => {
    const offenders = tsFiles()
      .filter((path) => !WHITE_ALLOWED.has(path))
      .filter((path) => classesOf(path).some((token) => ['text', 'bg', 'border'].some((prefix) => utilityOf(token) === `${prefix}-white`)))
    expect(offenders).toEqual([])
  })

  it('no surface token is oklch(1 0 0)', () => {
    const declared: string[] = []
    sheet(TOKENS).walkDecls((declaration) => {
      if (declaration.value.includes('oklch(1 0 0)')) declared.push(declaration.prop)
    })
    expect(declared.filter((prop) => prop !== '--paper-ink-foreground')).toEqual([])
  })

  it('the browser-chrome colours are the app’s paper, which is its background', async () => {
    const { THEME_COLOR } = await import(join(ROOT, moduleOf('THEME_COLOR')))
    const light = paperLayer(':root')
    const dark = paperLayer('.dark')
    expect(THEME_COLOR).toEqual({ light: light.get('--paper'), dark: dark.get('--paper') })
    expect(light.get('--background')).toBe('var(--paper)')
  })
})

describe('data palette', () => {
  it('the chart series hexes are typed in ui/styles/data-palette.css and nowhere else', () => {
    const series: string[] = []
    sheet(PALETTE).walkDecls(/^--data-series-[1-8]$/, (declaration) => { series.push(declaration.value) })
    expect(series).toHaveLength(16)
    const offenders = [...tsFiles().filter((path) => summaryOf(path).literals.some((text) => series.some((hex) => text.includes(hex)))), ...cssFiles()
      .filter((path) => path !== PALETTE)
      .filter((path) => {
        const values: string[] = []
        sheet(path).walkDecls((declaration) => { values.push(declaration.value) })
        return values.some((value) => series.some((hex) => value.includes(hex)))
      })]
    expect(offenders).toEqual([])
  })
})

describe('capitals', () => {
  const setsCapitals = (path: string): boolean => classesOf(path).some((token) => token === 'uppercase') || summaryOf(path).identifiers.includes('uppercase')
  const setsCapitalsInStyle = (path: string): boolean => {
    let found = false
    sheet(path).walkDecls('text-transform', (declaration) => {
      if (declaration.value === 'uppercase') found = true
    })
    return found
  }

  it('only the wordmark and codes are set in capitals', () => {
    const offenders = [...tsFiles().filter((path) => setsCapitals(path) && !CAPITALS_ALLOWED.has(path)), ...cssFiles().filter(setsCapitalsInStyle)]
    expect(offenders).toEqual([])
  })

  it('the allowlist has no stale entry', () => {
    const stale = [...CAPITALS_ALLOWED].filter((path) => !setsCapitals(path))
    expect(stale).toEqual([])
  })
})

describe('answer text size', () => {
  const ANSWER_SIZES = ['1.0625rem', '17px', '15px', '13.5px'].map((size) => `text-[${size}]`)
  const answerModules = [...tsFiles()].filter(
    (path) =>
      path.startsWith('shared/components/MarkdownRenderer/') ||
      path.startsWith('ui/features/chat/components/agent-response/') ||
      path === moduleOf('AnatomyBlock') ||
      path.startsWith('ui/features/cards/'),
  )

  it('the token is 16px and the card ramp reads it', () => {
    expect(valuesOf(sheet(TOKENS), '--text-answer')).toContain('1rem')
    for (const step of ['card-body', 'card-title', 'card-figure-16']) {
      const rule = rulesWith(sheet(GLOBALS), `.${step}`)
      expect(rule.some((node) => declarationsOf(node).get('font-size') === 'var(--text-answer)'), step).toBe(true)
    }
  })

  it('no answer surface sets the old in-between sizes (17px lede, 15px block body, 13.5px card row)', () => {
    const offenders = answerModules.filter((path) => classesOf(path).some((token) => ANSWER_SIZES.includes(utilityOf(token))))
    expect(offenders).toEqual([])
  })
})

describe('tracking', () => {
  it('nothing but the wordmark sets a negative letter-spacing', () => {
    const offenders = [
      ...tsFiles()
        .filter((path) => path !== moduleOf('Logo'))
        .filter((path) => classesOf(path).some((token) => ['tracking-tight', 'tracking-tighter'].includes(utilityOf(token)) || utilityOf(token).startsWith('tracking-[-'))),
      ...cssFiles().filter((path) => {
        let negative = false
        sheet(path).walkDecls('letter-spacing', (declaration) => {
          if (declaration.value.startsWith('-')) negative = true
        })
        return negative
      }),
    ]
    expect(offenders).toEqual([])
  })
})

describe('five neutrals, three elevations', () => {
  it('the five neutrals are the spec’s', () => {
    const layer = light()
    for (const [name, hex] of [['sheet', '#ffffff'], ['paper', '#fafaf9'], ['desk', '#f2f1f0'], ['selected', '#e7e5e3'], ['pressed', '#dcdad7']]) {
      expect(layer.get(`--${name}`), name).toBe(hex)
    }
  })

  it('the light paper and desk are the brand’s surface and sunken surface (corporate design)', () => {
    const brand = sheet(BRAND_TOKENS)
    const ds = (name: string): string | undefined => valuesOf(brand, `--ds-${name}`)[0]
    const layer = light()
    expect(layer.get('--paper')).toBe(ds('surface'))
    expect(layer.get('--desk')).toBe(ds('surface-sunken'))
  })

  it('hairline and edge are ink alpha', () => {
    const layer = light()
    expect(layer.get('--hairline')).toBe('rgb(15 14 13 / 0.08)')
    expect(layer.get('--edge')).toBe('rgb(15 14 13 / 0.12)')
  })

  it('the elevation steps are distinct and each one is visible (an edge ring plus a shadow)', () => {
    const layer = light()
    const steps = ['elevation-1', 'elevation-2', 'elevation-3'].map((name) => layer.get(`--${name}`) ?? '')
    expect(new Set(steps).size).toBe(3)
    for (const step of steps) expect(step).toMatch(/^0 0 0 1px (rgb\(15 14 13|var\(--edge\))/)
    expect(layer.get('--elevation-xs')).not.toBe(layer.get('--elevation-sm'))
    expect(layer.get('--elevation-sm')).toBe('var(--elevation-1)')
    expect(layer.get('--elevation-md')).toBe('var(--elevation-2)')
    expect(layer.get('--elevation-lg')).toBe('var(--elevation-3)')
  })

  it('the radius ladder is 6 / 10 / 16 / full, with no stray --radius', () => {
    const tokens = sheet(TOKENS)
    expect(valuesOf(tokens, '--radius-overlay')).toContain('16px')
    expect(valuesOf(tokens, '--radius-inline')).toContain('6px')
    expect(valuesOf(tokens, '--radius')).toEqual([])
  })

  it('the neutral ladder steps at least 1.07:1 in both themes, and the dark desk is lighter than its paper', () => {
    for (const [selector, layer] of [[':root', light()], ['.dark', dark()]] as const) {
      const hex = (name: string): string => layer.get(`--${name}`) ?? ''
      for (const [a, b] of [['paper', 'desk'], ['desk', 'selected'], ['selected', 'pressed']]) {
        expect(ratio(hex(a ?? ''), hex(b ?? '')), `${selector} ${a} → ${b}`).toBeGreaterThanOrEqual(1.07)
      }
      if (selector === '.dark') expect(luminance(hex('desk'))).toBeGreaterThan(luminance(hex('paper')))
      if (selector === '.dark') expect(luminance(hex('sheet'))).toBeGreaterThan(luminance(hex('selected')))
      expect(ratio(hex('sheet'), hex('selected')), `${selector} sheet → selected`).toBeGreaterThanOrEqual(1.2)
      expect(ratio(hex('paper'), hex('sheet')), `${selector} paper → sheet`).toBeGreaterThanOrEqual(1.04)
    }
  })

  it('a sheet carries the 12% edge in both themes (elevation 1 opens with it)', () => {
    for (const layer of [light(), dark()]) {
      expect(layer.get('--elevation-1')?.startsWith('0 0 0 1px var(--edge),')).toBe(true)
    }
  })

  it('a sheet is white on every surface that draws a document or a floating bar', () => {
    const tile = moduleOf('FileTileBody')
    expect(literalHasRun(tile, ['bg-sheet', 'shadow-sm'])).toBe(true)
    expect(stringConst(parseSource(moduleOf('FOLDER_SHEET')), 'FOLDER_SHEET')).toBe('rounded-surface bg-sheet shadow-sm')
    expect(summaryOf(moduleOf('InspectorGroup')).literals).toContain('bg-sheet shadow-sm overflow-hidden rounded-surface')
    expect(literalHasRun(moduleOf('SelectionBar', 'ui/features/documents/'), ['bg-sheet', 'shadow-md', 'rounded-overlay'])).toBe(true)
  })
})


const attributeWith = (root: ts.Node, name: string, value: string): boolean =>
  nodesOf(root, ts.isJsxAttribute).some(
    (attribute) => ts.isIdentifier(attribute.name) && attribute.name.text === name && !!attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === value,
  )

const attributeShape = (root: ts.Node, name: string, expected: string): boolean =>
  nodesOf(root, ts.isJsxAttribute).some(
    (attribute) =>
      ts.isIdentifier(attribute.name) &&
      attribute.name.text === name &&
      !!attribute.initializer &&
      ts.isJsxExpression(attribute.initializer) &&
      !!attribute.initializer.expression &&
      shapeOf(attribute.initializer.expression) === expected,
  )

const hasClassAttribute = (root: ts.Node, classes: string): boolean => attributeWith(root, 'className', classes)

const attributeHasRun = (root: ts.Node, name: string, run: readonly string[]): boolean =>
  nodesOf(root, ts.isJsxAttribute).some(
    (attribute) =>
      ts.isIdentifier(attribute.name) &&
      attribute.name.text === name &&
      !!attribute.initializer &&
      ts.isStringLiteral(attribute.initializer) &&
      hasRun(classesOfText(attribute.initializer.text), run),
  )

function propertyStrings(root: ts.Node, name: string): string[] {
  return nodesOf(root, ts.isPropertyAssignment)
    .filter((property) => (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === name)
    .flatMap((property) => (ts.isStringLiteral(property.initializer) ? [property.initializer.text] : []))
}

function initializerOf(root: ts.Node, name: string): ts.Expression | undefined {
  return nodesOf(root, ts.isVariableDeclaration).find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name)?.initializer
}

const classesOfAttributes = (element: Opening): string[] =>
  nodesOf(element.attributes, ts.isStringLiteralLike).flatMap((literal) => classesOfText(literal.text))

const childShapes = (element: ts.JsxElement): string[] =>
  element.children.flatMap((child) => (ts.isJsxExpression(child) && child.expression ? [shapeOf(child.expression)] : []))

const elementOf = (opening: Opening): ts.JsxElement | undefined => {
  const parent = opening.parent
  return ts.isJsxOpeningElement(opening) && parent && ts.isJsxElement(parent) ? parent : undefined
}

const DATEIEN_DIRS = ['ui/features/documents/', 'ui/features/inbound-mail/']
const inDocumentsOrMail = (path: string): boolean => DATEIEN_DIRS.some((dir) => path.startsWith(dir))

describe('the secondary press', () => {
  it('the kit draws secondary as the raised white press', () => {
    const button = parseSource(moduleOf('buttonVariants'))
    expect(propertyStrings(button, 'secondary').some((value) => value.startsWith('bg-sheet text-foreground shadow-press hover:bg-sheet-hover active:bg-pressed '))).toBe(true)
    expect(summaryOf(moduleOf('buttonVariants')).literals.some((text) => text.includes('in-data-[surface=sunken]'))).toBe(false)
  })

  it('Dateien and the E-Mail-Eingang set no outline button', () => {
    const offenders = tsFiles()
      .filter(inDocumentsOrMail)
      .filter((path) =>
        elementsNamed(parseSource(path), ['Button', 'BusyButton']).some((element) => {
          const variant = attributeOf(element, 'variant')?.initializer
          if (variant && ts.isStringLiteral(variant)) return variant.text === 'outline'
          return variant !== undefined && nodesOf(variant, ts.isStringLiteralLike).some((literal) => literal.text === 'outline')
        }),
      )
    expect(offenders).toEqual([])
  })
})

describe('press, thumb and sheet', () => {
  it('the press rests on its edge alone and fills one step under the pointer', () => {
    const tokens = sheet(TOKENS)
    expect(valuesOf(tokens, '--elevation-press')).toContain('0 0 0 1px var(--edge)')
    expect(valuesOf(tokens, '--shadow-press')).toContain('var(--elevation-press)')
    expect(propertyStrings(parseSource(moduleOf('buttonVariants')), 'secondary').some((value) => value.startsWith('bg-sheet text-foreground shadow-press hover:bg-sheet-hover active:bg-pressed dark:'))).toBe(true)
  })

  it('in dark only a sheet or a thumb is lighter than its plane: a press is its plane’s fill with the 16% edge', () => {
    const secondary = propertyStrings(parseSource(moduleOf('buttonVariants')), 'secondary')
    expect(secondary.some((value) => hasRun(classesOfText(value), ['dark:bg-transparent', 'dark:hover:bg-hover', 'dark:active:bg-foreground/[0.1]']))).toBe(true)
  })

  it('a chip is never the press’s shape: a 28px pill of the desk, no edge; picked, the selected grey and a tick', () => {
    const toggle = parseSource(moduleOf('toggleVariants'))
    const chip = propertyStrings(toggle, 'chip')[0] ?? ''
    expect(chip.startsWith('rounded-full bg-desk ')).toBe(true)
    expect(classesOfText(chip)).toContain('data-[state=on]:bg-selected')
    expect(chip.includes('shadow') || chip.includes('bg-sheet') || chip.includes('border')).toBe(false)
    const variantObject = nodesOf(toggle, ts.isObjectLiteralExpression).some(
      (object) =>
        propertyStrings(object, 'variant').includes('chip') && propertyStrings(object, 'className').some((value) => value.startsWith('relative h-7 ')),
    )
    expect(variantObject).toBe(true)
    expect(elementsNamed(parseSource(moduleOf('OpenPointsPanel')), ['ToggleGroupItem']).some((element) => shapeOfAttribute(element, 'value') === 'ALL_CHIP')).toBe(true)
  })

  it('the thumb is white with the 1px shadow, and only ever on a track', () => {
    const group = parseSource(moduleOf('ToggleGroup'))
    expect(propertyStrings(group, 'default')).toContain('bg-sheet shadow-thumb')
    const isActive = initializerOf(group, 'isActive')
    expect(isActive && shapeOf(isActive).startsWith('context . segmented &&')).toBe(true)
    expect(hasShape(parseSource(moduleOf('SectionNav')), "onTrack ? 'bg-sheet shadow-thumb' : 'bg-selected'")).toBe(true)
  })

  it('the thumb has an edge at 3:1 against its track in dark, where its fill stands only 1.2:1 above it', () => {
    const layer = dark()
    expect(layer.get('--elevation-thumb')?.startsWith('0 0 0 1px var(--field-border)')).toBe(true)
    expect(ratio(layer.get('--field-border') ?? '', layer.get('--desk') ?? '')).toBeGreaterThanOrEqual(3)
  })

  it('a folder is a sheet that opens: 56px, radius 10, elevation 1, a chevron at its end', () => {
    expect(stringConst(parseSource(moduleOf('FOLDER_SHEET')), 'FOLDER_SHEET')).toBe('rounded-surface bg-sheet shadow-sm')
    const tile = parseSource(moduleOf('FolderCard'))
    expect(elementsNamed(tile, ['FileTileBody']).some((element) => stringAttribute(element, 'className')?.startsWith('flex h-14 '))).toBe(true)
    expect(elementsNamed(tile, ['FolderName']).some((element) => shapeOfAttribute(element, 'text') === 'folder . name')).toBe(true)
    expect(elementsNamed(tile, ['ChevronRight']).some((element) => stringAttribute(element, 'data-slot') === 'folder-opens')).toBe(true)
  })

  it('Dateien draws neither look itself: no shadow-xs or shadow-press outside the kit, no fill over a press', () => {
    const surface = tsFiles().filter((path) => inAffordance(path) && !path.startsWith('ui/components/'))
    const looks = surface.filter((path) => classesOf(path).some((token) => unvaried(token) && ['shadow-xs', 'shadow-press'].includes(token)))
    expect(looks).toEqual([])
    const filled = surface.filter((path) =>
      elementsNamed(parseSource(path), ['Button', 'BusyButton']).some(
        (element) =>
          stringAttribute(element, 'variant') === 'secondary' &&
          (stringAttribute(element, 'className') ?? '')
            .split(' ')
            .some((token) => unvaried(token) && token.startsWith('bg-') && token !== 'bg-sheet' && !token.startsWith('bg-sheet-') && /^[a-z]$/.test(token.charAt(3))),
      ),
    )
    expect(filled).toEqual([])
  })
})

describe('lines for lists, space for sections', () => {
  const classesWithoutHeader = (path: string): string[] => {
    const tokens: string[] = []
    walk(parseSource(path), (node) => {
      if (!(ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))) return
      const declaration = node.parent && ts.isVariableDeclaration(node.parent) ? node.parent : undefined
      if (declaration && ts.isIdentifier(declaration.name) && declaration.name.text === 'SECTION_HEADER_CLASS') return
      tokens.push(...classesOfText(node.text))
    })
    return tokens
  }

  it('Dateien and the E-Mail-Eingang draw no rule between sections (a list’s rows use ROW_HAIRLINE)', () => {
    const offenders = tsFiles()
      .filter(inDateien)
      .filter((path) => classesWithoutHeader(path).some((token) => unvaried(token) && ['border-t', 'border-b', 'divide-y', 'border-dashed'].includes(utilityOf(token))))
    expect(offenders).toEqual([])
  })

  it('the header band ends in one rule', () => {
    const band = stringConst(parseSource(moduleOf('ProjectSectionFrame')), 'SECTION_HEADER_CLASS') ?? ''
    expect(hasRun(classesOfText(band), ['border-b', 'border-border'])).toBe(true)
  })

  it('the hairline is the token, and the Papierkorb, Offene Punkte and the mail list wear it', () => {
    expect(classesOf(moduleOf('ROW_HAIRLINE')).includes('after:bg-hairline')).toBe(true)
    for (const name of ['FolderBinPanel', 'OpenPointsPanel', 'InboundMailRow']) {
      expect(summaryOf(moduleOf(name)).identifiers.some((identifier) => identifier.includes('ROW_HAIRLINE')), name).toBe(true)
    }
  })

  it('one inset rule: every row line in Dateien is ROW_HAIRLINE or its table form, never a hairline of its own', () => {
    const ownLines = tsFiles()
      .filter(inDateien)
      .filter((path) => classesOf(path).includes('after:bg-hairline') || summaryOf(path).literals.some((text) => text.includes('linear-gradient(var(--hairline)')))
    expect(ownLines).toEqual([])
    for (const name of ['InboundMailRow', 'AttachmentRow', 'FolderRow', 'FileListView']) {
      expect(summaryOf(moduleOf(name)).identifiers.some((identifier) => identifier.includes('ROW_HAIRLINE')), name).toBe(true)
    }
  })

  it('Dateien names its planes: no „one grey“ fill (bg-muted, bg-secondary) where a desk, a sheet or a selection is meant', () => {
    const surfaces = new Set([...modulesOf('DocumentKindThumbnail', 'FilePreviewDocumentPanel', 'FileTextPage', 'InspectorGroup')])
    const offenders = tsFiles()
      .filter((path) => inDateien(path) || surfaces.has(path))
      .filter((path) => classesOf(path).some((token) => unvaried(token) && ['bg-muted', 'bg-secondary'].includes(utilityOf(token))))
    expect(offenders).toEqual([])
  })
})

describe('one left edge', () => {
  const valueAfter = (path: string, first: string, prefix: string): string | undefined => {
    for (const tokens of classRunsOf(path)) {
      const at = tokens.indexOf(first)
      const next = at >= 0 ? tokens[at + 1] : undefined
      if (next?.startsWith(prefix)) return next.slice(prefix.length)
    }
    return undefined
  }

  it('the file grid bleeds by the tile shell’s inset', () => {
    const shell = valueAfter(moduleOf('FileTileBody'), 'rounded-surface', 'p-')
    const bleed = classRunsOf(moduleOf('FileGrid'))
      .find((tokens) => tokens.includes('items-stretch'))
      ?.find((token) => token.startsWith('-mx-'))
      ?.slice('-mx-'.length)
    expect(shell).toBeDefined()
    expect(bleed).toBe(shell)
  })

  it('the file list bleeds by its cells’ inset on a desk', () => {
    const cell = (stringConst(parseSource(moduleOf('FileListLayoutContext')), 'FILE_LIST_CELL') ?? '').split(' ')[0]?.slice('px-'.length)
    const bleed = classRunsOf(moduleOf('FileListView'))
      .map((tokens) => {
        const at = tokens.indexOf('@container/filelist')
        if (at < 0 || tokens[at + 2] !== 'pb-4' || tokens[at + 3] !== 'pt-1' || tokens[at + 5] !== 'md:px-0') return undefined
        return tokens[at + 4]?.startsWith('md:-mx-') ? tokens[at + 4]?.slice('md:-mx-'.length) : undefined
      })
      .find((value) => value !== undefined)
    expect(cell).toBeDefined()
    expect(bleed).toBe(cell)
  })
})


const WORD_GHOSTS_ALLOWED: Record<string, string> = {
  'FilesHeaderControls#files-open-points': 'navigation: a place, when no tabs show it',
  'FilesHeaderControls#files-inbound-mail': 'navigation: a place, when no tabs show it',
  'InboundMailWorkspace#inbound-mail-back': 'navigation: the way back to the list',
  'FileFilterMenu#file-filter-direction': 'a menu row: it flips the order the row above chose',
  'MailText#text.showLess': 'disclosure: it shows the rest of the mail already there',
  'MailText#text.hideQuoted': 'disclosure: it shows the quoted mail already there',
  'SelectionBar#selection-all': 'it refines the pick beside the bar’s one action, the move',
  'UploadTray#uploads.actions.cancelAll': 'the tray’s way out, on the headline’s row: as a press it took a row of its own on a phone',
}

describe('a press looks pressable', () => {
  const wordGhosts = (): { path: string; keys: string[] }[] =>
    tsFiles()
      .filter(inAffordance)
      .flatMap((path) => {
        const file = parseSource(path)
        const names = declaredExports(file)
        return elementsNamed(file, ['Button', 'BusyButton', 'SuggestionButton'])
          .filter((element) => {
            const variant = attributeOf(element, 'variant')?.initializer
            const ghost = variant !== undefined && (ts.isStringLiteral(variant) ? ['ghost', 'link'].includes(variant.text) : nodesOf(variant, ts.isStringLiteralLike).some((literal) => ['ghost', 'link'].includes(literal.text)))
            const size = attributeOf(element, 'size')?.initializer
            const icon = size !== undefined && (ts.isStringLiteral(size) ? size.text.startsWith('icon') : nodesOf(size, ts.isStringLiteralLike).some((literal) => literal.text.startsWith('icon')))
            return ghost && !icon
          })
          .map((element) => names.map((name) => `${name}#${pressKeyOf(element)}`))
          .map((keys) => ({ path, keys }))
      })

  it('a worded press on Dateien, the preview and the brief is tonal unless the allowlist says why not', () => {
    const offenders = wordGhosts().filter(({ keys }) => !keys.some((key) => key in WORD_GHOSTS_ALLOWED))
    expect(offenders.map(({ keys }) => keys[0] ?? '')).toEqual([])
  })

  it('the allowlist has no stale entry', () => {
    const keys = new Set(wordGhosts().flatMap(({ keys: candidates }) => candidates))
    expect(Object.keys(WORD_GHOSTS_ALLOWED).filter((key) => !keys.has(key))).toEqual([])
  })
})

describe('a choice sits on its track', () => {
  it('the kit draws the track and has no trackless form', () => {
    const kit = moduleOf('ToggleGroup')
    expect(literalHasRun(kit, ['rounded-control', 'bg-desk', 'p-0.5'])).toBe(true)
    expect(classesOf(kit).includes('bare') || summaryOf(kit).identifiers.includes('bare')).toBe(false)
    expect(literalHasRun(moduleOf('SectionNav'), ['rounded-control', 'bg-desk', 'p-0.5'])).toBe(true)
  })

  it('Dateien’s tabs sit on the same track, so grey alone means a press and never „chosen“', () => {
    const frame = parseSource(moduleOf('ProjectSectionFrame'))
    expect(elementsNamed(frame, ['SectionNav']).map((element) => attributeOf(element, 'track') !== undefined || classesOfAttributes(element).includes('track'))).toEqual([true])
  })

  it('every single choice on Dateien, the preview and the brief is segmented', () => {
    const offenders = tsFiles()
      .filter(inAffordance)
      .filter((path) =>
        elementsNamed(parseSource(path), ['ToggleGroup']).some(
          (element) => stringAttribute(element, 'type') === 'single' && attributeOf(element, 'segmented') === undefined && !classesOfAttributes(element).includes('segmented'),
        ),
      )
    expect(offenders).toEqual([])
  })
})

describe('one ramp, one scale', () => {
  const surface = (): string[] => tsFiles().filter(inDateien)
  const offending = (test: (utility: string) => boolean): string[] => surface().filter((path) => classesOf(path).some((token) => test(utilityOf(token))))

  it('text is the ramp: 11px codes and counts, 12px meta, 13px names, 14px body, 16px fields, 18px a mail subject', () => {
    expect(offending((utility) => /^text-\[[0-9.]+(px|rem)\]$/.test(utility) && utility !== 'text-[13px]' && utility !== 'text-[11px]')).toEqual([])
    expect(offending((utility) => ['text-xl', 'text-2xl', 'text-3xl'].includes(utility))).toEqual([])
  })

  it('line heights are the named steps, never a typed ratio', () => {
    expect(offending((utility) => utility.startsWith('leading-['))).toEqual([])
  })

  it('a radius is a step of the app ladder by its name (inline, control, surface, overlay, full)', () => {
    const radii = ['rounded', 'rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-xl']
    expect(surface().filter((path) => classesOf(path).some((token) => unvaried(token) && radii.includes(token.startsWith('!') ? token.slice(1) : token)))).toEqual([])
  })

  it('a press is the kit’s 32px (`size="sm"`), never a 28px override', () => {
    expect(offending((utility) => utility === 'h-7')).toEqual([])
  })

  it('an empty state is bare, never the kit’s dashed grey panel', () => {
    const offenders = surface().filter((path) => elementsNamed(parseSource(path), ['EmptyState']).some((element) => stringAttribute(element, 'variant') !== 'bare'))
    expect(offenders).toEqual([])
  })

  it('a listing is the shared container, never a typed 1280px', () => {
    expect(offending((utility) => utility === 'max-w-[1280px]')).toEqual([])
  })
})

describe('the agent’s disc', () => {
  const CLAIMS_A_SUGGESTION = modulesOf('AttachmentRow')
  it('Dateien and the E-Mail-Eingang draw it only where it marks a suggestion', () => {
    const offenders = tsFiles()
      .filter(inDateien)
      .filter((path) => summaryOf(path).identifiers.includes('AgentGlyph') && !CLAIMS_A_SUGGESTION.has(path))
    expect(offenders).toEqual([])
  })
})

describe('one separator', () => {
  const UNBOUND = ' · '
  const unboundSeparator = (path: string): boolean => {
    let found = false
    walk(parseSource(path), (node) => {
      if (ts.isStringLiteral(node) && node.text === UNBOUND) found = true
      if ((ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)) && node.text.startsWith(UNBOUND)) found = true
      if (ts.isJsxText(node) && node.text.startsWith(UNBOUND)) found = true
    })
    return found
  }

  it('Dateien and the E-Mail-Eingang join clauses with the bound separator, never a bare „ · “', () => {
    expect(tsFiles().filter(inDateien).filter(unboundSeparator)).toEqual([])
  })

  it('the E-Mail-Eingang’s copy binds every middot to the clause before it', () => {
    const offenders = (['de', 'en'] as const).flatMap((locale) => {
      const copy: string[] = []
      const visit = (value: unknown): void => {
        if (typeof value === 'string') copy.push(value)
        else if (value && typeof value === 'object') Object.values(value).forEach(visit)
      }
      visit(dictionaries[locale].inboundMail)
      return copy.filter((text) => text.includes(UNBOUND)).map((text) => `${locale}: ${text.trim()}`)
    })
    expect(offenders).toEqual([])
  })
})

describe('one size for a segmented control', () => {
  it('every worded segmented group in Dateien is 14px', () => {
    const offenders = tsFiles()
      .filter(inDateien)
      .filter((path) =>
        elementsNamed(parseSource(path), ['ToggleGroup']).some((element) => {
          const segmented = attributeOf(element, 'segmented') !== undefined || classesOfAttributes(element).includes('segmented')
          const icon = (stringAttribute(element, 'size') ?? '').startsWith('icon')
          return segmented && !icon && !classesOfAttributes(element).includes('[&>button]:text-sm')
        }),
      )
    expect(offenders).toEqual([])
  })
})

describe('a folder row in the table’s columns', () => {
  const list = (): ts.SourceFile => parseSource(moduleOf('FileListView'))
  const row = (): ts.SourceFile => parseSource(moduleOf('FolderRow'))

  it('the folders are the table’s first rows, in the size and date columns’ own cells', () => {
    const body = nodesOf(list(), ts.isJsxElement).find(
      (element) => tagOf(element.openingElement) === 'TableBody' && shapeOfAttribute(element.openingElement, 'ref') === 'bodyRef',
    )
    const expressions = body ? childShapes(body) : []
    expect(expressions[0]).toBe('folderRows')
    expect(expressions[1]?.startsWith('rows . map')).toBe(true)
    expect(elementsNamed(row(), ['TableRow']).length).toBeGreaterThan(0)
    const cells = elementsNamed(row(), ['TableCell'])
    expect(cells.some((cell) => shapeOfAttribute(cell, 'className') === 'cn ( FILE_LIST_SIZE_CELL , FILE_LIST_CELL )')).toBe(true)
    expect(cells.some((cell) => shapeOfAttribute(cell, 'className') === 'cn ( FILE_LIST_DATE_CELL , FILE_LIST_CELL )')).toBe(true)
    const pane = parseSource(moduleOf('FileBrowserPane'))
    const endsADiv = nodesOf(pane, ts.isJsxSelfClosingElement).some((folder) => {
      const parent = folder.parent
      return tagOf(folder) === 'FolderRow' && parent !== undefined && ts.isJsxElement(parent) && tagOf(parent.openingElement) === 'div' && parent.children.filter((child) => !(ts.isJsxText(child) && child.text.trim() === '')).at(-1) === folder
    })
    expect(endsADiv).toBe(false)
  })

  it('dates left-align with their head, numbers right-align with theirs', () => {
    const layout = parseSource(moduleOf('FileListLayoutContext'))
    expect(stringConst(layout, 'FILE_LIST_DATE_CELL')?.startsWith('hidden whitespace-nowrap text-left ')).toBe(true)
    expect(stringConst(layout, 'FILE_LIST_SIZE_CELL')?.startsWith('hidden whitespace-nowrap text-right ')).toBe(true)
    const offenders = elementsNamed(list(), ['TableHead', 'TableCell']).filter(
      (element) =>
        stringAttribute(element, 'column') === 'added' &&
        shapeOfAttribute(element, 'sort') === 'sort' &&
        shapeOfAttribute(element, 'onSort') === 'setSort' &&
        stringAttribute(element, 'align') === 'right',
    )
    expect(offenders).toEqual([])
  })

  it('every row is 40px: a chip in a name line is 20px, the actions cell holds its 32px trigger in 40', () => {
    expect(elementsNamed(list(), ['DocumentStatusBadge']).some((element) => stringAttribute(element, 'className')?.startsWith('h-5 '))).toBe(true)
    expect(hasClassAttribute(list(), 'w-10 px-1 py-1 text-right pointer-coarse:w-11 pointer-coarse:px-0')).toBe(true)
    expect(hasClassAttribute(row(), 'w-10 px-1 py-1 text-right pointer-coarse:w-11 pointer-coarse:px-0')).toBe(true)
  })
})

describe('said once per view', () => {
  it('the preview header draws no format box and no type chip', () => {
    const chrome = parseSource(moduleOf('FilePreviewChrome'))
    expect(elementsNamed(chrome, ['FileExtChip'])).toEqual([])
    expect(nodesOf(chrome, ts.isCallExpression).filter((call) => calleeName(call) === 'tagLabel')).toEqual([])
  })
})

describe('colour is a verdict', () => {
  it('Offene Punkte rings its points by verdict: ink, ochre only for the reader’s or an overdue one', () => {
    expect(elementsNamed(parseSource(moduleOf('OpenPointsPanel')), ['MarkRowContent']).some((element) => stringAttribute(element, 'marker') === 'verdict')).toBe(true)
    const row = parseSource(moduleOf('MarkRowContent'))
    const ring = initializerOf(row, 'VERDICT_RING')
    const ringValues = ring && ts.isAsExpression(ring) && ts.isObjectLiteralExpression(ring.expression) ? ring.expression : undefined
    expect(ringValues && propertyStrings(ringValues, 'ink')).toEqual(['var(--foreground)'])
    expect(ringValues && propertyStrings(ringValues, 'needsYou')).toEqual(['var(--text-color-feedback-warning)'])
    expect(hasShape(row, "marker === 'verdict' && 'bg-sheet text-foreground shadow-none'")).toBe(true)
    expect(hasShape(row, "marker === 'verdict' && ! needsReader && 'border-[1.5px]'")).toBe(true)
    const needsReader = initializerOf(row, 'needsReader')
    expect(needsReader && shapeOf(needsReader)).toBe('isLive ( annotation ) && ( overdue || isForReader ( annotation , viewerId ) )')
  })

  it('a mention of the reader in a mark wins by weight on the desk, not by ochre', () => {
    expect(attributeWith(parseSource(moduleOf('MarkBody')), 'meTone', 'ink')).toBe(true)
    expect(hasShape(parseSource(moduleOf('MentionText')), "meTone === 'ink' ? 'bg-desk text-foreground font-semibold'")).toBe(true)
  })

  it('a face in Dateien is no hue: the preview’s and the list’s assignees are neutral', () => {
    expect(elementsNamed(parseSource(moduleOf('AssignmentFaces')), ['AvatarStack']).some((element) => stringAttribute(element, 'tone') === 'neutral')).toBe(true)
  })

  it('the brief says what needs the reader with a glyph, never a bare dot', () => {
    const brief = parseSource(moduleOf('FolderBrief'))
    expect(elementsNamed(brief, ['AttentionGlyph']).some((element) => ts.isJsxSelfClosingElement(element) && shapeOfAttribute(element, 'tone') === 'tone')).toBe(true)
    expect(elementsNamed(brief, ['ToneSwatch']).length).toBeLessThanOrEqual(2)
  })
})

describe('one primary per area', () => {
  it('the reader’s primary yields while a batch is picked', () => {
    const bar = parseSource(moduleOf('DecisionBar', 'ui/features/inbound-mail/'))
    expect(hasShape(bar, "impersonation || yieldPrimary ? 'secondary' : 'default'")).toBe(true)
    expect(hasShape(bar, "impersonation && ! yieldPrimary ? 'default' : 'secondary'")).toBe(true)
    expect(attributeShape(parseSource(moduleOf('InboundMailWorkspace')), 'yieldPrimary', 'selectedIds . length > 0')).toBe(true)
  })

  it('the reader’s primary is the verb, and the sentence beside it says what one press files', () => {
    const bar = parseSource(moduleOf('DecisionBar', 'ui/features/inbound-mail/'))
    expect(hasShape(bar, "onlyDismiss ? t ( 'bar.dismiss' ) : t ( 'bar.file' )")).toBe(true)
    expect(attributeShape(bar, 'aria-describedby', 'onlyDismiss ? undefined : summaryId')).toBe(true)
  })
})

describe('rows, weights and the phone', () => {
  it('a list row is a name and one meta line: the Papierkorb says the rest once, in a second line only on a phone', () => {
    const bin = parseSource(moduleOf('FolderBinPanel'))
    const descriptions = elementsNamed(bin, ['ItemDescription']).flatMap((element) => {
      const className = stringAttribute(element, 'className')
      return className === undefined ? [] : [classesOfText(className)]
    })
    expect(descriptions.filter((classes) => !classes.includes('sm:hidden'))).toHaveLength(1)
    expect(
      elementsNamed(bin, ['Button', 'BusyButton']).some(
        (element) => stringAttribute(element, 'variant') === 'secondary' && stringAttribute(element, 'size') === 'sm' && shapeOfAttribute(element, 'className') === 'RESTORE_PRESS',
      ),
    ).toBe(true)
    expect((stringConst(bin, 'RESTORE_PRESS') ?? '').startsWith('pointer-coarse:size-11 pointer-coarse:px-0 pointer-fine:w-8 ')).toBe(true)
    expect(
      elementsNamed(bin, ['span']).some((element) => {
        const parent = elementOf(element)
        return (
          stringAttribute(element, 'className') === 'sr-only pointer-fine:group-hover/row:not-sr-only pointer-fine:group-focus-within/row:not-sr-only' &&
          parent !== undefined &&
          childShapes(parent).includes("t ( 'bin.restore' )")
        )
      }),
    ).toBe(true)
    expect(elementsNamed(bin, ['ul']).some((element) => stringAttribute(element, 'className') === '-mx-4 flex max-w-[calc(880px+2rem)] flex-col')).toBe(true)
    const phoneLines = nodesOf(bin, ts.isCallExpression)
      .filter((call) => shapeOf(call.expression) === 'meta . phone . map')
      .some((call) =>
        elementsNamed(call, ['ItemDescription']).some(
          (element) => stringAttribute(element, 'className') === 'text-meta truncate first-letter:uppercase sm:hidden' && shapeOfAttribute(element, 'key') === 'index',
        ),
      )
    expect(phoneLines).toBe(true)
    expect(literalHasRun(moduleOf('FolderBinPanel'), ['group/row', 'items-center', 'gap-3', 'rounded-surface', 'py-2.5'])).toBe(true)
    expect(summaryOf(moduleOf('InboundMailRow')).literals.some((text) => text.startsWith('group/row items-start rounded-control px-3 py-2.5 '))).toBe(true)
    expect(summaryOf(moduleOf('MarkRowContent')).literals.some((text) => text.startsWith('flex w-full gap-3 rounded-control px-2.5 py-2.5 '))).toBe(true)
  })

  it('a mail subject’s weight is its state: 600 needs the reader, 500 waits on a press, 440 is handled', () => {
    const subject = parseSource(moduleOf('InboundMailRow'))
    expect(hasShape(subject, "needsReader ? 'text-foreground font-semibold' : waiting ? 'text-foreground font-medium' : 'text-foreground font-normal'")).toBe(true)
    expect(literalHasRun(moduleOf('InboundMailRow'), ['line-clamp-2', 'text-name', 'text-pretty'])).toBe(true)
  })

  it('a thread’s press sits in a 40px line with 8px under it, so it never touches the open row’s sheet', () => {
    expect(hasClassAttribute(parseSource(moduleOf('InboundMailList')), 'box-content flex h-10 items-center justify-between gap-2 px-4 pb-2 pointer-coarse:h-11')).toBe(true)
  })

  it('the reader’s foot says what one press files only once the choice it repeats has scrolled away', () => {
    const bar = parseSource(moduleOf('DecisionBar', 'ui/features/inbound-mail/'))
    expect(hasShape(bar, "choiceInView && 'hidden'")).toBe(true)
    expect(hasShape(bar, '! onlyDismiss && ! ( yieldPrimary && ! impersonation ) &&')).toBe(true)
    expect(attributeShape(parseSource(moduleOf('InboundMailDetail')), 'ref', 'choiceRef')).toBe(true)
    expect(literalHasRun(moduleOf('SenderTrustLine'), ['min-w-0', 'max-w-[64ch]'])).toBe(true)
  })

  it('an empty state’s headline is the section step, and a string to copy is mono 13/20/440', () => {
    const empty = parseSource(moduleOf('EmptyState'))
    expect(
      elementsNamed(empty, ['p']).some((element) => {
        const parent = elementOf(element)
        return stringAttribute(element, 'className') === 'text-balance text-section text-foreground' && parent !== undefined && childShapes(parent).includes('title')
      }),
    ).toBe(true)
    const address = moduleOf('InboundMailAddressBlock')
    expect(classRunsOf(address).filter((tokens) => hasRun(tokens, ['font-mono', 'text-[13px]', 'leading-5', 'font-normal'])).length).toBe(2)
    expect(classRunsOf(address).some((tokens) => hasRun(tokens, ['font-mono', 'text-sm']))).toBe(false)
  })

  it('a field is white with the 3:1 field border, never a desk well', () => {
    expect(valuesOf(sheet(TOKENS), '--field-border')).toContain('#8a8784')
    expect(attributeHasRun(parseSource(moduleOf('FileSearchBar')), 'inputClassName', ['border-field-border', 'bg-sheet'])).toBe(true)
  })

  it('on a phone a folder is a 56px sheet in two columns with its ⋯, and Hochladen a 56px glyph', () => {
    const tile = moduleOf('FolderCard')
    expect(mentions(tile, 'FOLDER_ROWS_ON_PHONE')).toBe(false)
    expect(literalHasRun(tile, ['phone:gap-2.5', 'phone:pr-10'])).toBe(true)
    expect(literalHasRun(tile, ['absolute', 'right-8', 'top-1/2', 'z-[1]', '-translate-y-1/2', 'phone:right-1.5', 'pointer-coarse:opacity-100'])).toBe(true)
    expect(literalHasRun(moduleOf('UploadFab'), ['[&_button]:size-14', '[&_button]:rounded-full'])).toBe(true)
    expect(nodesOf(parseSource(moduleOf('FileWorkspace')), ts.isPropertyAssignment).some((property) => ts.isIdentifier(property.name) && property.name.text === 'glyphOnly' && property.initializer.kind === ts.SyntaxKind.TrueKeyword)).toBe(true)
  })

  it('Offene Punkte keeps its text to a measure and stands who and by when on the column’s edge', () => {
    expect(elementsNamed(parseSource(moduleOf('OpenPointsPanel')), ['MarkRowContent']).some((element) => attributeOf(element, 'columns') !== undefined)).toBe(true)
    const row = moduleOf('MarkRowContent')
    expect(hasShape(parseSource(row), "columns && 'max-w-[720px]'")).toBe(true)
    expect(literalHasRun(row, ['text-muted-foreground', 'ml-auto', 'hidden', 'shrink-0', 'items-start', 'gap-4'])).toBe(true)
  })

  it('the places stand clear of the title: 24px under the title block, 16px on a phone', () => {
    expect(summaryOf(moduleOf('ProjectSectionFrame')).literals.includes('-mb-2 mt-6 min-w-0 phone:mt-4')).toBe(true)
  })

  it('on a phone the tabs name only the open place, and a page’s one ⋯ stands on the title’s line', () => {
    const frame = parseSource(moduleOf('ProjectSectionFrame'))
    expect(elementsNamed(frame, ['SectionNav']).some((element) => attributeOf(element, 'track') !== undefined && attributeOf(element, 'compactOnPhone') !== undefined)).toBe(true)
    for (const name of ['InboundMailWorkspace', 'OpenPointsPanel']) {
      expect(elementsNamed(parseSource(moduleOf(name)), ['ProjectSectionActions']).some((element) => attributeOf(element, 'onTitleLine') !== undefined), name).toBe(true)
    }
  })

  it('the brief’s sheet stands on the column’s edge, its content 16px in, on a phone too', () => {
    const card = elementsNamed(parseSource(moduleOf('FolderBrief')), ['Card'])[0]
    const classes = card ? classesOfAttributes(card) : []
    expect(classes.some((token) => token.includes('-mx-') || token.includes('rounded-none'))).toBe(false)
  })

  it('the preview’s title is the section step and its page lies at elevation 2 on the desk', () => {
    expect(hasClassAttribute(parseSource(moduleOf('FilePreviewChrome')), 'text-foreground truncate text-section')).toBe(true)
    for (const name of ['FilePreviewDocumentPanel', 'FileTextPage']) {
      expect(summaryOf(moduleOf(name)).literals.includes('shadow-lg'), name).toBe(false)
    }
    expect(hasShape(parseSource(moduleOf('FilePreviewBody')), "! peeking && ! reader && 'bg-desk'")).toBe(true)
  })

  it('the label step is 12/16/500 (`SectionLabel`, the card eyebrow)', () => {
    const [rule] = rulesWith(sheet(GLOBALS), '.card-eyebrow')
    const declarations = rule?.nodes.filter((node): node is Declaration => node.type === 'decl').slice(0, 3).map((node) => `${node.prop}:${node.value}`)
    expect(declarations).toEqual(['font-size:12px', 'line-height:16px', 'font-weight:500'])
  })
})

describe('a sheet keeps its edge', () => {
  it('nothing between the file card and its thumbnail sheet clips', () => {
    const card = parseSource(moduleOf('FileCard', 'ui/features/documents/'))
    const button = nodesOf(card, ts.isCallExpression)
      .filter((call) => calleeName(call) === 'cn')
      .map((call) => call.arguments[0])
      .filter((argument): argument is ts.StringLiteral => argument !== undefined && ts.isStringLiteral(argument) && argument.text.startsWith('group relative flex w-full min-w-0 flex-col'))
      .map((argument) => argument.text)[0] ?? ''
    expect(button, 'the card button').toContain('overflow-visible')
    expect(button).not.toContain('overflow-hidden')
    expect(elementsNamed(card, ['FileTileBody']).some((element) => {
      const className = expressionAttribute(element, 'className')
      return className !== undefined && ts.isCallExpression(className) && ts.isStringLiteral(className.arguments[0] as ts.Node) && (className.arguments[0] as ts.StringLiteral).text.startsWith('overflow-visible p-0')
    })).toBe(true)
  })
})

describe('a sheet keeps its edge on a filled section', () => {
  it('the fill frame leaves 1px above its content for a sheet ring', () => {
    expect(hasShape(parseSource(moduleOf('ProjectSectionFrame')), "fill ? 'overflow-hidden pt-px'")).toBe(true)
  })
})

describe('the row ⋯ hides nothing', () => {
  it('the object menu trigger beside a name has no disc that would cover the line under it', () => {
    const menu = moduleOf('DocumentObjectMenu')
    expect(propertyStrings(parseSource(menu), 'className')).toContain('size-8 shrink-0 rounded-full')
    const runs = classRunsOf(menu)
    expect(runs.some((tokens) => tokens.some((token, at) => token.startsWith('bg-background/') && tokens[at + 1] === 'backdrop-blur'))).toBe(false)
  })
})

describe('Dateien in a real project (round 6)', () => {
  it('draws no upload tile among the files: Hochladen and the whole page take files, its menu says so', () => {
    expect(summaryOf(moduleOf('FileBrowserPane')).identifiers.some((identifier) => identifier.includes('uploadCard'))).toBe(false)
    const uppy = moduleOf('ProjectUppyUpload')
    expect(summaryOf(uppy).identifiers.some((identifier) => identifier.includes('dropcard'))).toBe(false)
    expect(summaryOf(uppy).literals.some((text) => text.includes('dropcard'))).toBe(false)
    expect(attributeWith(parseSource(uppy), 'data-testid', 'project-upload-limits')).toBe(true)
  })

  it('lays the upload tray on the listing’s column as a sheet, not a band across the page', () => {
    const workspace = parseSource(moduleOf('FileWorkspace'))
    const column = nodesOf(workspace, ts.isJsxElement).find((element) => tagOf(element.openingElement) === 'div' && stringAttribute(element.openingElement, 'className') === 'listing-container shrink-0 px-4 md:px-8')
    const first = column?.children.find((child) => !(ts.isJsxText(child) && child.text.trim() === ''))
    const tray = first && ts.isJsxElement(first) ? first.openingElement : first && ts.isJsxSelfClosingElement(first) ? first : undefined
    expect(tray && tagOf(tray)).toBe('UploadTray')
    expect(tray && shapeOfAttribute(tray, 'className')).toBe('UPLOAD_TRAY_SHEET')
    expect(hasRun(classesOfText(stringConst(parseSource(moduleOf('UPLOAD_TRAY_SHEET')), 'UPLOAD_TRAY_SHEET') ?? ''), ['bg-sheet', 'shadow-sm'])).toBe(true)
  })

  it('never cuts the selection’s count, and lets the brief’s line wrap rather than cut', () => {
    const bar = moduleOf('SelectionBar', 'ui/features/documents/')
    expect(hasClassAttribute(parseSource(bar), 'whitespace-nowrap text-sm font-medium tabular-nums')).toBe(true)
    expect(classesOf(bar).includes('phone:sr-only')).toBe(false)
    expect(elementsNamed(parseSource(bar), ['Button']).some((element) => stringAttribute(element, 'variant') === 'link' && stringAttribute(element, 'data-testid') === 'selection-all')).toBe(true)
    const count = elementsNamed(parseSource(bar), ['p']).find((element) => stringAttribute(element, 'data-testid') === 'selection-count')
    expect(count && classesOfAttributes(count).includes('truncate')).toBeFalsy()
    expect(elementsNamed(parseSource(bar), ['p']).some((element) => stringAttribute(element, 'role') === 'status' && classesOfAttributes(element).includes('truncate'))).toBe(false)
    const toggle = elementsNamed(parseSource(moduleOf('FolderBrief')), ['button']).find((element) => stringAttribute(element, 'data-attr') === 'folder-brief-toggle')
    expect(toggle && classesOfAttributes(toggle).includes('truncate')).toBeFalsy()
  })

  it('lets the upload tray’s summary wrap rather than cut', () => {
    const tray = parseSource(moduleOf('UploadTray'))
    expect(elementsNamed(tray, ['p']).some((element) => stringAttribute(element, 'aria-live') === 'polite' && (stringAttribute(element, 'className') ?? '').startsWith('text-pretty text-sm font-medium'))).toBe(true)
  })

  it('floats the selection’s bar on the column’s edges, centred only where the column is', () => {
    expect(literalHasRun(moduleOf('SelectionBar', 'ui/features/documents/'), ['md:mx-8', 'md:max-w-[1216px]', '@min-[90rem]/section:mx-auto!'])).toBe(true)
  })

  it('gives the places their room on a narrow section: every place keeps its name, a narrow one gives up its glyph', () => {
    const nav = parseSource(moduleOf('SectionNav'))
    expect(hasShape(nav, "compactOnPhone && ! active && 'phone:sr-only'")).toBe(true)
    expect(hasShape(nav, "onTrack && 'md:@max-[44rem]/section:hidden'")).toBe(true)
  })
})

describe('Dateien after the review of 2026-11-10 (round 7)', () => {
  it('stands every meta line of a row on one baseline: the tiles stretch and the meta line keeps the foot', () => {
    expect(literalHasRun(moduleOf('FileCard', 'ui/features/documents/'), ['group/foot', 'mt-0'])).toBe(false)
    expect(literalHasRun(moduleOf('FileTileBody'), ['text-muted-foreground', 'mt-auto', 'flex', 'w-full'])).toBe(true)
    const card = parseSource(moduleOf('FileCard', 'ui/features/documents/'))
    expect(
      nodesOf(card, ts.isCallExpression).some((call) => {
        const options = call.arguments[0]
        const first = options && ts.isObjectLiteralExpression(options) ? options.properties[0] : undefined
        return (
          calleeName(call) === 'documentBadgeState' &&
          first !== undefined &&
          ts.isPropertyAssignment(first) &&
          ts.isIdentifier(first.name) &&
          first.name.text === 'versionState' &&
          shapeOf(first.initializer) === 'file . versionState'
        )
      }),
    ).toBe(true)
  })

  it('gives the brief’s read line 24px over it and 32px under it, and the upload sheet 24px over it', () => {
    const pane = parseSource(moduleOf('FileBrowserPane'))
    expect(nodesOf(pane, ts.isJsxAttribute).some((attribute) => {
      const initializer = attribute.initializer
      return ts.isIdentifier(attribute.name) && attribute.name.text === 'className' && initializer !== undefined && ts.isJsxExpression(initializer) && initializer.expression !== undefined && ts.isTemplateExpression(initializer.expression) && shapeOf(initializer.expression.templateSpans[0]?.expression ?? initializer.expression) === 'CONTENT_MAX' && initializer.expression.templateSpans[0]?.literal.text === ' px-4 pb-4 pt-6'
    })).toBe(true)
    expect((stringConst(parseSource(moduleOf('UPLOAD_TRAY_SHEET')), 'UPLOAD_TRAY_SHEET') ?? '').startsWith('mt-2 mb-4 ')).toBe(true)
  })

  it('draws a request that asks the reader as an edged ink chip, never in a verdict’s colour', () => {
    const chipModule = moduleOf('AsksYouChip')
    const literals = summaryOf(chipModule).literals
    const chip = literals.find((text) => text.startsWith('bg-sheet shadow-press text-foreground ')) ?? ''
    const tokens = classesOfText(chip)
    expect(tokens.indexOf('h-7') >= 0 && tokens.indexOf('rounded-full') > tokens.indexOf('h-7')).toBe(true)
    expect(literals.some((text) => ['ochre', 'warning', 'destructive', 'signal'].some((word) => text.includes(word)))).toBe(false)
    expect(elementsNamed(parseSource(moduleOf('FolderBrief')), ['AsksYouChip']).some((element) => shapeOfAttribute(element, 'onPress') === '( ) => onCollapsedChange ( false )')).toBe(true)
  })

  it('keeps „Alle abbrechen“ on the upload tray’s headline row while it sends', () => {
    expect(hasShape(parseSource(moduleOf('UploadTray')), "summary . isSettled ? 'order-3 basis-full sm:order-2 sm:basis-auto' : 'order-2'")).toBe(true)
  })
})
