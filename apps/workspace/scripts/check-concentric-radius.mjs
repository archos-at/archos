#!/usr/bin/env node
// A rounded box inside a rounded box takes the outer radius less the gap between them (design-language.md, "Concentric radius").
// node scripts/check-concentric-radius.mjs [--fix] | --live [/dev/route …] [--base=http://localhost:3311] [--chrome=<binary>]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseSource } from '@babel/parser'

const UI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const RADIUS_TOKENS = 'ui/styles/tokens.css'
const BRAND_TOKENS = 'shared/brand/tokens.vars.css'
const SCANNED_DIRS = ['app', 'ui', 'shared']
const PX_PER_SPACING_STEP = 4
const UNEVEN_SIDES_PX = 2
const SQUARE_CORNER_PX = 4
const SEMANTIC_STEPS = ['none', 'control', 'surface', 'overlay']
const SIDES = { '': [0, 1, 2, 3], x: [1, 3], y: [0, 2], t: [0], r: [1], b: [2], l: [3], s: [3], e: [1] }
const CLASS_JOINERS = /^(cn|clsx|cx|twMerge)$/
const AST_BOOKKEEPING = new Set(['loc', 'start', 'end', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'range', 'file'])

export function readLadder(radiusTokensCss, brandTokensCss) {
  const brand = Object.fromEntries([...brandTokensCss.matchAll(/--ds-radius-([\w-]+):\s*(\d+(?:\.\d+)?)px/g)].map((m) => [m[1], Number(m[2])]))
  const ladder = { none: 0, full: Infinity }
  for (const [, name, raw] of radiusTokensCss.matchAll(/--radius-([\w-]+):\s*([^;]+);/g)) {
    const px = /^(\d+(?:\.\d+)?)px$/.exec(raw.trim())?.[1] ?? brand[/var\(--ds-radius-([\w-]+)\)/.exec(raw)?.[1]]
    if (px !== undefined) ladder[name] = Number(px)
  }
  return ladder
}

const ladderSteps = (ladder) => new Set(Object.values(ladder).filter((px) => px !== Infinity))

export function radiusClass(px, ladder) {
  const step = SEMANTIC_STEPS.find((name) => ladder[name] === px)
  return step ? `rounded-${step}` : `rounded-[${px}px]`
}

function spacingPx(token) {
  if (token === 'px') return 1
  if (/^\d+(\.\d+)?$/.test(token)) return Number(token) * PX_PER_SPACING_STEP
  const arbitrary = /^\[(\d+(?:\.\d+)?)px\]$/.exec(token)
  return arbitrary ? Number(arbitrary[1]) : undefined
}

export function boxOf(classes, ladder) {
  const box = { radius: undefined, radiusClass: undefined, pad: [0, 0, 0, 0], border: [0, 0, 0, 0], margin: [0, 0, 0, 0] }
  for (const cls of classes.filter((c) => !c.includes(':'))) {
    let m
    if ((m = /^rounded(?:-(.+))?$/.exec(cls))) {
      const px = m[1] === undefined ? ladder.DEFAULT ?? 4 : ladder[m[1]] ?? spacingPx(m[1])
      if (px !== undefined) Object.assign(box, { radius: px, radiusClass: cls })
    } else if ((m = /^(p|m)([xytrblse]?)-(.+)$/.exec(cls)) && spacingPx(m[3]) !== undefined) {
      for (const side of SIDES[m[2]]) box[m[1] === 'p' ? 'pad' : 'margin'][side] = spacingPx(m[3])
    } else if ((m = /^border(?:-([xytrblse]))?(?:-(\d+))?$/.exec(cls))) {
      for (const side of SIDES[m[1] ?? '']) box.border[side] = m[2] === undefined ? 1 : Number(m[2])
    }
  }
  box.floats = classes.some((c) => c === 'absolute' || c === 'fixed')
  box.clips = classes.some((c) => c === 'overflow-hidden' || c === 'overflow-clip')
  box.centersItsContent = classes.some((c) => /^(justify-center|place-items-center|place-content-center)$/.test(c))
  box.fillsItsOuter = classes.some((c) => /^(flex-1|grow|w-full|h-full|size-full|inset-0|self-stretch)$/.test(c))
  box.paints = classes.some((c) => /^(bg-(?!transparent|clip|cover|contain|center|no-repeat)|border$|border-[xytrblse]$|shadow(?!-none)|ring(-\d+)?$|outline$)/.test(c))
  return box
}

const isAstNode = (value) => value && typeof value === 'object' && typeof value.type === 'string'

function childNodes(node) {
  return Object.entries(node)
    .filter(([key]) => !AST_BOOKKEEPING.has(key))
    .flatMap(([, value]) => (Array.isArray(value) ? value.filter(isAstNode) : isAstNode(value) ? [value] : []))
}

const isElement = (node) => node.type === 'JSXElement'

function literalText(node) {
  if (node.type === 'StringLiteral') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked
  return undefined
}

function unconditionalClassLiterals(expr, consts) {
  const out = []
  const seen = new Set()
  const visit = (node) => {
    if (!node || seen.has(node)) return
    seen.add(node)
    const callee = node.type === 'CallExpression' && node.callee.type === 'Identifier' ? node.callee.name : undefined
    if (literalText(node) !== undefined) out.push(node)
    else if (node.type === 'JSXExpressionContainer' || node.type === 'ParenthesizedExpression') visit(node.expression)
    else if (node.type === 'BinaryExpression' && node.operator === '+') [node.left, node.right].forEach(visit)
    else if (callee && CLASS_JOINERS.test(callee)) node.arguments.forEach(visit)
    else if (callee === 'cva') visit(node.arguments[0])
    else if (callee && consts.has(callee)) visit(consts.get(callee))
    else if (node.type === 'Identifier' && consts.has(node.name)) visit(consts.get(node.name))
  }
  visit(expr)
  return out
}

const classesIn = (literals) => literals.flatMap((lit) => literalText(lit).split(/\s+/).filter(Boolean))

function tagName(name) {
  if (name.type === 'JSXIdentifier') return name.name
  if (name.type === 'JSXMemberExpression') return `${tagName(name.object)}.${tagName(name.property)}`
  return `${name.namespace.name}:${name.name.name}`
}

const jsxName = (node) => tagName(node.openingElement.name)
const classNameAttr = (node) => node.openingElement.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === 'className')
const elementClassLiterals = (node, consts) => {
  const attr = classNameAttr(node)
  return attr?.value ? unconditionalClassLiterals(attr.value, consts) : []
}
const literalHolding = (literals, cls) => literals.find((lit) => literalText(lit).split(/\s+/).includes(cls))

function parseUnit(file, text) {
  const ast = parseSource(text, { sourceType: 'module', plugins: ['jsx', 'typescript'], errorRecovery: true })
  const consts = new Map()
  const collect = (node) => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) consts.set(node.id.name, node.init)
    if (literalText(node) !== undefined) node.file = file
    childNodes(node).forEach(collect)
  }
  collect(ast.program)
  return { file, ast, consts }
}

function resolveImportedConsts(units) {
  const topLevel = new Map()
  for (const unit of units) {
    for (const stmt of unit.ast.program.body) {
      const decl = stmt.type === 'ExportNamedDeclaration' ? stmt.declaration : stmt
      if (decl?.type !== 'VariableDeclaration') continue
      for (const d of decl.declarations) {
        if (d.id.type === 'Identifier' && d.init) topLevel.set(d.id.name, topLevel.has(d.id.name) ? null : d.init)
      }
    }
  }
  for (const unit of units) {
    for (const stmt of unit.ast.program.body.filter((s) => s.type === 'ImportDeclaration')) {
      for (const spec of stmt.specifiers) {
        const init = topLevel.get(spec.imported?.name ?? spec.local.name)
        if (init && !unit.consts.has(spec.local.name)) unit.consts.set(spec.local.name, init)
      }
    }
  }
}

function returnedJsx(node) {
  if (node.type === 'CallExpression') return node.arguments.flatMap(returnedJsx)
  if (!/Function(Expression|Declaration)$/.test(node.type)) return []
  if (node.body.type !== 'BlockStatement') return [node.body]
  const out = []
  const visit = (n) => {
    if (n.type === 'ReturnStatement' && n.argument) out.push(n.argument)
    else if (!/Function/.test(n.type)) childNodes(n).forEach(visit)
  }
  node.body.body.forEach(visit)
  return out
}

const isChildrenSlot = (node) =>
  node.type === 'JSXExpressionContainer' &&
  ((node.expression.type === 'Identifier' && node.expression.name === 'children') ||
    (node.expression.type === 'MemberExpression' && node.expression.property.name === 'children'))

function elementsDownToChildren(element) {
  const search = (n, trail) => {
    if (isChildrenSlot(n)) return trail
    for (const c of childNodes(n)) {
      const found = search(c, isElement(c) ? [...trail, c] : trail)
      if (found) return found
    }
    return undefined
  }
  return search(element, []) ?? []
}

function componentRootBox(component, unit) {
  let root
  let reached = false
  const visit = (n, inOwnLayer) => {
    if (reached) return
    if (isElement(n)) {
      const passThrough = !classNameAttr(n) && /(Portal|Provider)$/.test(jsxName(n))
      if (!passThrough) {
        reached = true
        const literals = elementClassLiterals(n, unit.consts)
        if (literals.length > 0) root = { literals, inOwnLayer: inOwnLayer || /\.(Sub)?Content$/.test(jsxName(n)), wrappersOfChildren: elementsDownToChildren(n), unit }
        return
      }
      inOwnLayer ||= /Portal$/.test(jsxName(n))
    }
    childNodes(n).forEach((c) => visit(c, inOwnLayer))
  }
  returnedJsx(component).forEach((jsx) => visit(jsx, false))
  return root
}

function componentDefinitions(units) {
  const defs = new Map()
  for (const unit of units) {
    for (const [name, init] of unit.consts) {
      const root = /^[A-Z]/.test(name) && componentRootBox(init, unit)
      if (root) defs.set(name, root)
    }
    const declarations = unit.ast.program.body.map((s) => (/^Export/.test(s.type) ? s.declaration : s))
    for (const decl of declarations) {
      const root = decl?.type === 'FunctionDeclaration' && /^[A-Z]/.test(decl.id?.name) && componentRootBox(decl, unit)
      if (root) defs.set(decl.id.name, root)
    }
  }
  return defs
}

function renderedChildElements(node, unit) {
  const out = []
  const followedHelpers = new Set()
  const visit = (n) => {
    if (isElement(n)) return out.push(n)
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && !followedHelpers.has(n.callee.name)) {
      const helper = unit.consts.get(n.callee.name)
      if (helper && /FunctionExpression$/.test(helper.type)) {
        followedHelpers.add(n.callee.name)
        visit(helper.body)
      }
    }
    childNodes(n).forEach(visit)
  }
  node.children.forEach(visit)
  return out
}

const addSides = (a, b) => a.map((v, i) => v + b[i])
const inset = (box) => addSides(box.pad, box.border)
const sourceKey = (source) => (source?.literal ? `${source.literal.file}:${source.literal.start}` : undefined)

function verdictOn(nesting, steps, plannedRadii = new Map()) {
  const R = plannedRadii.get(sourceKey(nesting.outer.source)) ?? nesting.outer.box.radius
  const r = plannedRadii.get(sourceKey(nesting.inner.source)) ?? nesting.inner.box.radius
  const [near, far] = nesting.gap
  const outerCannotGrowAround = !steps.has(r + near)
  if (!R || R === Infinity || !r || r === Infinity || near >= R || far - near > UNEVEN_SIDES_PX) return undefined
  if (far > R / 2 && outerCannotGrowAround) return undefined
  if (nesting.outer.box.clips && far <= Math.max(...nesting.outer.box.border)) return undefined
  if (nesting.outer.box.centersItsContent && !nesting.inner.box.fillsItsOuter) return undefined
  const [lowest, highest] = [Math.max(0, R - far), Math.max(0, R - near)]
  if (r >= lowest && r <= highest) return undefined
  return { R, r, expected: r < lowest ? lowest : highest }
}

export function check({ sources, ladder }) {
  const units = Object.entries(sources).map(([file, text]) => parseUnit(file, text))
  resolveImportedConsts(units)
  const defs = componentDefinitions(units)
  const steps = ladderSteps(ladder)
  const nestings = []

  const resolve = (node, unit) => {
    const name = jsxName(node)
    const def = defs.get(name)
    const own = elementClassLiterals(node, unit.consts)
    const box = boxOf([...(def ? classesIn(def.literals) : []), ...classesIn(own)], ladder)
    const ownRadiusClass = boxOf(classesIn(own), ladder).radiusClass
    const source = ownRadiusClass
      ? { literal: literalHolding(own, ownRadiusClass), cls: ownRadiusClass }
      : box.radiusClass && def && { literal: literalHolding(def.literals, box.radiusClass), cls: box.radiusClass }
    const wrappers = (def?.wrappersOfChildren ?? []).map((el) => inset(boxOf(classesIn(elementClassLiterals(el, def.unit.consts)), ladder)))
    return { name, box, source: source || undefined, inOwnLayer: def?.inOwnLayer ?? false, childInset: wrappers.reduce(addSides, inset(box)) }
  }

  const descend = (outer, node, unit, gap) => {
    for (const child of renderedChildElements(node, unit)) {
      const inner = resolve(child, unit)
      if (inner.box.floats || inner.inOwnLayer) continue
      const sideGap = addSides(gap, inner.box.margin)
      if (inner.box.radius === undefined) descend(outer, child, unit, addSides(sideGap, inner.childInset))
      else nestings.push({ file: unit.file, line: child.loc.start.line, outer, inner, gap: [Math.min(...sideGap), Math.max(...sideGap)] })
    }
  }

  for (const unit of units) {
    const visit = (node) => {
      if (isElement(node)) {
        const outer = resolve(node, unit)
        if (outer.box.radius > 0) descend(outer, node, unit, outer.childInset)
      }
      childNodes(node).forEach(visit)
    }
    visit(unit.ast.program)
  }
  const findings = nestings.flatMap((n) => {
    const verdict = verdictOn(n, steps)
    return verdict ? [{ ...n, ...verdict }] : []
  })
  return { findings, nestings, ladder }
}

const PREFERENCE = { ladderStep: 0, exactValue: 1, growOuter: 2, squareCorner: 3 }

function offersFor(nesting, verdict, steps) {
  const [near, far] = nesting.gap
  const grown = verdict.r + near
  if (!nesting.outer.box.paints && near === far) {
    return [{ source: nesting.outer.source, px: grown, preference: steps.has(grown) ? PREFERENCE.ladderStep : PREFERENCE.exactValue }]
  }
  const shrink = steps.has(verdict.expected) ? PREFERENCE.ladderStep : verdict.expected >= SQUARE_CORNER_PX ? PREFERENCE.exactValue : PREFERENCE.squareCorner
  const offers = [{ source: nesting.inner.source, px: verdict.expected, preference: shrink }]
  if (near === far && grown > verdict.R && steps.has(grown)) offers.push({ source: nesting.outer.source, px: grown, preference: PREFERENCE.growOuter })
  return offers
}

export function planFixes({ nestings, ladder }) {
  const steps = ladderSteps(ladder)
  const nestingsBySource = new Map()
  for (const n of nestings) {
    for (const key of [sourceKey(n.inner.source), sourceKey(n.outer.source)].filter(Boolean)) nestingsBySource.set(key, [...(nestingsBySource.get(key) ?? []), n])
  }
  const planned = new Map()
  const plannedSources = new Map()
  const failing = (list) => list.filter((n) => verdictOn(n, steps, planned)).length
  const gainOf = (offer) => {
    const touched = nestingsBySource.get(offer.key) ?? []
    const before = failing(touched)
    const previous = planned.get(offer.key)
    planned.set(offer.key, offer.px)
    const gain = before - failing(touched)
    if (previous === undefined) planned.delete(offer.key)
    else planned.set(offer.key, previous)
    return gain
  }
  for (;;) {
    const offers = new Map()
    for (const n of nestings) {
      const verdict = verdictOn(n, steps, planned)
      if (!verdict) continue
      for (const offer of offersFor(n, verdict, steps)) {
        const key = sourceKey(offer.source)
        if (key) offers.set(`${key}=${offer.px}`, { ...offer, key })
      }
    }
    const best = [...offers.values()]
      .map((offer) => ({ ...offer, gain: gainOf(offer) }))
      .filter((offer) => offer.gain > 0)
      .sort((a, b) => a.preference - b.preference || b.gain - a.gain)[0]
    if (!best) break
    planned.set(best.key, best.px)
    plannedSources.set(best.key, best.source)
  }
  const edits = [...planned].map(([key, px]) => ({ source: plannedSources.get(key), to: radiusClass(px, ladder) }))
  return { edits, left: failing(nestings) }
}

export function rewrite(sources, edits) {
  const changed = {}
  for (const [file, fileEdits] of Map.groupBy(edits, (e) => e.source.literal.file)) {
    let text = sources[file]
    for (const { source, to } of fileEdits.sort((a, b) => b.source.literal.start - a.source.literal.start)) {
      const [start, end] = [source.literal.start + 1, source.literal.end - 1]
      text = text.slice(0, start) + text.slice(start, end).split(/(\s+)/).map((token) => (token === source.cls ? to : token)).join('') + text.slice(end)
    }
    changed[file] = text
  }
  return changed
}

function readTree(root) {
  const walk = (dir) =>
    !fs.existsSync(dir) ? [] : fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(full)
      return /\.tsx$/.test(entry.name) && !/\.spec\.tsx$/.test(entry.name) ? [full] : []
    })
  const files = SCANNED_DIRS.flatMap((dir) => walk(path.join(root, dir)))
  return {
    sources: Object.fromEntries(files.map((full) => [path.relative(root, full), fs.readFileSync(full, 'utf8')])),
    ladder: readLadder(fs.readFileSync(path.join(root, RADIUS_TOKENS), 'utf8'), fs.readFileSync(path.join(root, BRAND_TOKENS), 'utf8')),
  }
}

const describeFinding = (f) => {
  const gap = f.gap[0] === f.gap[1] ? f.gap[0] : `${f.gap[0]}–${f.gap[1]}`
  const elsewhere = (side) => (side.source?.literal && side.source.literal.file !== f.file ? ` (${side.source.literal.file})` : '')
  return `${f.file}:${f.line}  <${f.inner.name}>${elsewhere(f.inner)} radius ${f.r}, ${gap}px inside <${f.outer.name}>${elsewhere(f.outer)} radius ${f.R}: wants ${f.expected}`
}

const measureRenderedNestings = ({ unevenSides }) => {
  const px = (v) => parseFloat(v) || 0
  const uniformRadius = (el) => {
    const cs = getComputedStyle(el)
    const radii = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(px)
    return radii.every((v) => v === radii[0]) && radii[0] < 999 ? radii[0] : 0
  }
  const label = (el) => `${el.tagName.toLowerCase()}${el.dataset.slot ? `[${el.dataset.slot}]` : ''}`
  const out = new Set()
  for (const el of document.querySelectorAll('body *')) {
    const r = uniformRadius(el)
    if (!r || !el.checkVisibility() || el.closest('nextjs-portal')) continue
    let outer = el.parentElement
    while (outer && outer !== document.body && px(getComputedStyle(outer).borderTopLeftRadius) === 0) outer = outer.parentElement
    const R = outer && outer !== document.body ? uniformRadius(outer) : 0
    if (!R) continue
    const [e, o] = [el.getBoundingClientRect(), outer.getBoundingClientRect()]
    const scale = el.offsetWidth > 0 ? e.width / el.offsetWidth : 1
    const corners = [[e.left - o.left, e.top - o.top], [o.right - e.right, e.top - o.top], [e.left - o.left, o.bottom - e.bottom], [o.right - e.right, o.bottom - e.bottom]]
      .map(([dx, dy]) => [dx / scale, dy / scale])
    const off = corners.map(([dx, dy]) => [Math.min(dx, dy), Math.max(dx, dy)]).find(([near, far]) =>
      near >= 0 && far - near <= unevenSides && near < R && far <= R / 2 && (r < R - far - 1 || r > R - near + 1))
    if (off) out.add(`${label(el)} "${(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)}" radius ${r}, ${Math.round(off[1])}px inside ${label(outer)} radius ${R}: wants ${Math.round(R - off[1])}`)
  }
  return [...out]
}

async function checkRendered(args) {
  const { chromium } = await import('playwright-core')
  const option = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
  const named = args.filter((arg) => !arg.startsWith('--'))
  const routes = named.length > 0 ? named : fs.readdirSync(path.join(UI_ROOT, 'app/dev'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_')).map((entry) => `/dev/${entry.name}`)
  const browser = await chromium.launch({ executablePath: option('chrome') })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  let total = 0
  for (const route of routes) {
    const loaded = await page.goto(`${option('base', 'http://localhost:3311')}${route}`, { waitUntil: 'networkidle', timeout: 180_000 }).catch((error) => error)
    if (loaded instanceof Error) {
      total += 1
      console.log(`${route}  did not load: ${loaded.message.split('\n')[0]}`)
      continue
    }
    await page.waitForTimeout(500)
    const findings = await page.evaluate(measureRenderedNestings, { unevenSides: UNEVEN_SIDES_PX })
    total += findings.length
    for (const finding of findings) console.log(`${route}  ${finding}`)
  }
  await browser.close()
  return total
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.includes('--live')) {
    const total = await checkRendered(args.filter((arg) => arg !== '--live'))
    console.log(total === 0 ? 'Every rendered radius is concentric.' : `${total} rendered nesting(s) not concentric: fix the class where it is written.`)
    process.exit(total === 0 ? 0 : 1)
  }
  let tree = readTree(UI_ROOT)
  if (args.includes('--fix')) {
    const { edits } = planFixes(check(tree))
    for (const [file, text] of Object.entries(rewrite(tree.sources, edits))) fs.writeFileSync(path.join(UI_ROOT, file), text)
    for (const { source, to } of edits) console.log(`fixed  ${source.literal.file}:${source.literal.loc.start.line}  ${source.cls} → ${to}`)
    tree = readTree(UI_ROOT)
  }
  const { findings } = check(tree)
  for (const f of findings) console.log(describeFinding(f))
  console.log(findings.length === 0 ? 'Every nested radius is concentric.' : `${findings.length} nesting(s) not concentric. node scripts/check-concentric-radius.mjs --fix`)
  process.exit(findings.length === 0 ? 0 : 1)
}
