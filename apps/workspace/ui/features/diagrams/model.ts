export interface FlowModel {
  kind: 'flow'
  direction: 'down' | 'right'
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface FlowNode {
  id: string
  label: string
  shape: 'step' | 'decision' | 'end' | 'point'
}

export interface FlowEdge {
  id: string
  from: string
  to: string
  label?: string
  dashed?: boolean
}

export interface MapModel {
  kind: 'map'
  root: MapNode
}

export interface MapNode {
  id: string
  label: string
  children: MapNode[]
}

export interface HandoffModel {
  kind: 'handoff'
  parties: { id: string; label: string }[]
  steps: { from: string; to: string; label: string; reply: boolean }[]
}

export interface ScheduleModel {
  kind: 'schedule'
  sections: { label: string; tasks: ScheduleTask[] }[]
}

export interface ScheduleTask {
  label: string
  start: string
  end: string
  milestone: boolean
}

export interface SharesModel {
  kind: 'shares'
  title?: string
  items: { label: string; value: number }[]
}

export type DiagramModel = FlowModel | MapModel | HandoffModel | ScheduleModel | SharesModel

type Parsed = { type: string; db: Record<string, unknown> }

const call = (db: Record<string, unknown>, name: string): unknown => {
  const fn = db[name]
  return typeof fn === 'function' ? (fn as () => unknown).call(db) : undefined
}

const entries = (value: unknown): unknown[] =>
  value instanceof Map ? [...value.values()] : Array.isArray(value) ? value : value && typeof value === 'object' ? Object.values(value) : []

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {})

const lookup = (collection: unknown, key: string): unknown =>
  collection instanceof Map ? collection.get(key) : record(collection)[key]

export const MAX_GRAPH_NODES = 80

const LINE_BREAK = /<br\s*\/?>/gi
const FORMATTING_TAG = /<\/?(?:b|i|em|strong|u|s|small|sub|sup|span)(?:\s[^<>]*)?>/gi
const NAMED_ENTITY: Record<string, string> = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ' }

export function plainLabel(raw: string): string | null {
  const withoutTags = raw.replace(LINE_BREAK, '\n').replace(FORMATTING_TAG, '')
  if (/<[a-z/!]/i.test(withoutTags)) return null
  const entities = withoutTags.replace(/ﬂ°°/g, '&#').replace(/ﬂ°/g, '&').replace(/¶ß/g, ';')
  let unknown = false
  const decoded = entities.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
      if (Number.isInteger(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code)
    }
    const known = NAMED_ENTITY[name.toLowerCase()]
    if (known === undefined) unknown = true
    return known ?? whole
  })
  if (unknown) return null
  return decoded
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

const FLOW_SHAPE: Record<string, FlowNode['shape']> = {
  diamond: 'decision',
  hexagon: 'decision',
  stadium: 'end',
  circle: 'end',
  doublecircle: 'end',
  ellipse: 'end',
}

export function flowFromFlowchart(db: Record<string, unknown>): FlowModel | null {
  if (entries(call(db, 'getSubGraphs')).length > 0) return null
  const vertices = entries(call(db, 'getVertices')).map(record)
  if (vertices.length === 0 || vertices.length > MAX_GRAPH_NODES) return null
  const nodes: FlowNode[] = []
  for (const v of vertices) {
    const id = text(v.id)
    const label = v.labelType === 'markdown' ? null : plainLabel(text(v.text))
    if (label === null) return null
    nodes.push({ id, label: label || id, shape: FLOW_SHAPE[text(v.type)] ?? 'step' })
  }
  const edges: FlowEdge[] = []
  for (const [index, edge] of entries(call(db, 'getEdges')).map(record).entries()) {
    if (text(edge.stroke) === 'invisible') continue
    if (text(edge.type) !== 'arrow_point') return null
    const label = edge.labelType === 'markdown' ? null : plainLabel(text(edge.text))
    if (label === null) return null
    edges.push({
      id: text(edge.id) || `e${index}`,
      from: text(edge.start),
      to: text(edge.end),
      ...(label ? { label } : {}),
      ...(text(edge.stroke) === 'dotted' ? { dashed: true } : {}),
    })
  }
  const direction = /^(LR|RL)$/.test(text(call(db, 'getDirection'))) ? 'right' : 'down'
  return { kind: 'flow', direction, nodes, edges: edges.filter((e) => e.from && e.to) }
}

const STATE_POINTS = new Set(['root_start', 'root_end'])

export function flowFromState(db: Record<string, unknown>): FlowModel | null {
  const relations = entries(call(db, 'getRelations')).map(record)
  if (relations.length === 0) return null
  const states = call(db, 'getStates')
  if (entries(states).some((state) => Array.isArray(record(state).doc) || record(state).note !== undefined)) return null
  const ids = new Set<string>()
  const edges: FlowEdge[] = []
  for (const [index, relation] of relations.entries()) {
    const from = text(relation.id1)
    const to = text(relation.id2)
    ids.add(from)
    ids.add(to)
    const label = plainLabel(text(relation.relationTitle))
    if (label === null) return null
    edges.push({ id: `s${index}`, from, to, ...(label ? { label } : {}) })
  }
  for (const state of entries(states)) ids.add(text(record(state).id))
  ids.delete('')
  if (ids.size > MAX_GRAPH_NODES) return null
  const nodes: FlowNode[] = []
  for (const id of ids) {
    const node = stateNode(id, record(lookup(states, id)))
    if (!node) return null
    nodes.push(node)
  }
  const direction = /^(LR|RL)$/.test(text(call(db, 'getDirection'))) ? 'right' : 'down'
  return { kind: 'flow', direction, nodes, edges }
}

function stateNode(id: string, state: Record<string, unknown>): FlowNode | null {
  if (STATE_POINTS.has(id)) return { id, label: '', shape: 'point' }
  const type = text(state.type)
  if (type === 'start' || type === 'end') return { id, label: '', shape: 'point' }
  if (type === 'fork' || type === 'join') return null
  const label = stateLabel(state)
  if (label === null) return null
  if (type === 'choice') return { id, label, shape: 'decision' }
  return { id, label: label || id, shape: 'step' }
}

function stateLabel(state: Record<string, unknown>): string | null {
  const lines: string[] = []
  for (const description of entries(state.descriptions).map(text).filter(Boolean)) {
    const line = plainLabel(description)
    if (line === null) return null
    lines.push(line)
  }
  return lines.filter(Boolean).join('\n')
}

const unquoted = (label: string): string => {
  const quoted = /^"([^"]*)"$/.exec(label.trim())
  return quoted ? quoted[1] : label
}

function mapNode(node: unknown, path: string): MapNode | null {
  const n = record(node)
  const label = plainLabel(unquoted(text(n.descr) || text(n.nodeId)))
  if (label === null) return null
  const children: MapNode[] = []
  for (const [index, child] of entries(n.children).entries()) {
    const read = mapNode(child, `${path}.${index}`)
    if (!read) return null
    children.push(read)
  }
  return { id: path, label, children }
}

export function mapFromMindmap(db: Record<string, unknown>): MapModel | null {
  const root = call(db, 'getMindmap')
  if (!root) return null
  const tree = mapNode(root, 'root')
  if (!tree) return null
  const count = (node: MapNode): number => node.children.reduce((sum, child) => sum + count(child), 1)
  return count(tree) > MAX_GRAPH_NODES ? null : { kind: 'map', root: tree }
}

const NOTE_LINE_TYPE = 2

const REPLY_LINE_TYPES = new Set([1, 4, 6, 25, 51, 52, 53, 54, 55, 56, 57, 58])

export function handoffFromSequence(db: Record<string, unknown>): HandoffModel | null {
  const parties: HandoffModel['parties'] = []
  for (const actor of entries(call(db, 'getActors')).map(record)) {
    const label = plainLabel(text(actor.description) || text(actor.name))
    if (label === null) return null
    parties.push({ id: text(actor.name), label: label || text(actor.name) })
  }
  const known = new Set(parties.map((party) => party.id))
  const steps: HandoffModel['steps'] = []
  for (const m of entries(call(db, 'getMessages')).map(record)) {
    if (Number(m.type) === NOTE_LINE_TYPE) return null
    if (!known.has(text(m.from)) || !known.has(text(m.to))) continue
    const label = plainLabel(text(m.message))
    if (label === null) return null
    steps.push({ from: text(m.from), to: text(m.to), label, reply: REPLY_LINE_TYPES.has(Number(m.type)) })
  }
  return parties.length > 1 && steps.length > 0 ? { kind: 'handoff', parties, steps } : null
}

const asDate = (value: unknown): Date | null => {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? date : null
}

const atMidnight = (date: Date): boolean =>
  date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0

const calendarDate = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function scheduleFromGantt(db: Record<string, unknown>): ScheduleModel | null {
  const sections = new Map<string, ScheduleTask[]>()
  for (const task of entries(call(db, 'getTasks')).map(record)) {
    const start = asDate(task.startTime)
    const end = asDate(task.endTime) ?? start
    if (!start || !end) continue
    if (!atMidnight(start) || !atMidnight(end)) return null
    const section = plainLabel(text(task.section))
    const label = plainLabel(text(task.task))
    if (section === null || label === null) return null
    const list = sections.get(section) ?? []
    const milestone = task.milestone === true || end.getTime() <= start.getTime()
    list.push({ label, start: calendarDate(start), end: calendarDate(end), milestone })
    sections.set(section, list)
  }
  if (sections.size === 0) return null
  return { kind: 'schedule', sections: [...sections].map(([label, tasks]) => ({ label, tasks })) }
}

export function sharesFromPie(db: Record<string, unknown>): SharesModel | null {
  const sections = call(db, 'getSections')
  const pairs = sections instanceof Map ? [...sections] : Object.entries(record(sections))
  const items: SharesModel['items'] = []
  for (const [raw, amount] of pairs) {
    const label = plainLabel(String(raw))
    if (label === null) return null
    const value = Number(amount)
    if (Number.isFinite(value) && value > 0) items.push({ label, value })
  }
  if (items.length === 0) return null
  const title = plainLabel(text(call(db, 'getDiagramTitle')))
  if (title === null) return null
  return { kind: 'shares', ...(title ? { title } : {}), items }
}

export function modelFromParsed({ type, db }: Parsed): DiagramModel | null {
  if (type === 'flowchart-v2' || type === 'flowchart' || type === 'graph') return flowFromFlowchart(db)
  if (type === 'stateDiagram' || type === 'state') return flowFromState(db)
  if (type === 'mindmap') return mapFromMindmap(db)
  if (type === 'sequence') return handoffFromSequence(db)
  if (type === 'gantt') return scheduleFromGantt(db)
  if (type === 'pie') return sharesFromPie(db)
  return null
}
