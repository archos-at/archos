import 'server-only'

import { describeResource } from '@/lib/sharing/registry'
import type { OperationInput } from './dispatch'
import type { AgentOperation, LinkKind } from './operation'

type Row = Record<string, unknown>

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function callProjectId(op: AgentOperation, input: OperationInput): string | null {
  if (op.path.startsWith('/api/projects/[id]')) return text(input.params?.id)
  const query = isRow(input.query) ? input.query : {}
  const body = isRow(input.body) ? input.body : {}
  return text(query.projectId) ?? text(body.projectId)
}

function projectOf(row: Row, callProject: string | null): string | null {
  return 'projectId' in row ? text(row.projectId) : callProject
}

const enc = encodeURIComponent

interface Page {
  readonly idOf: (row: Row) => string | null
  readonly path: (id: string, row: Row, callProject: string | null) => string | null
}

const PAGES: Readonly<Record<LinkKind, Page>> = {
  project: {
    idOf: (row) => text(row.id),
    path: (id) => `/app/projects/${enc(id)}`,
  },
  document: {
    idOf: (row) => text(row.id),
    path: (id, row, callProject) => describeResource('document').deepLink(id, { projectId: projectOf(row, callProject) }),
  },
  'task-run': {
    idOf: (row) => text(row.runId) ?? text(row.id),
    path: (id, row, callProject) => {
      const project = projectOf(row, callProject)
      if (!project) return null
      const conversation = text(row.conversationId)
      if (conversation) return `/app/projects/${enc(project)}/chat?session=${enc(conversation)}&run=${enc(id)}`
      const task = text(row.taskId)
      return `/app/projects/${enc(project)}/automation?tab=tasks${task ? `&task=${enc(task)}` : ''}`
    },
  },
  conversation: {
    idOf: (row) => text(row.conversationId) ?? text(row.id),
    path: (id, row, callProject) => describeResource('conversation').deepLink(id, { projectId: projectOf(row, callProject) }),
  },
  'inbound-mail': {
    idOf: (row) => text(row.id),
    path: (id, row, callProject) => {
      const project = projectOf(row, callProject)
      return project ? `/app/projects/${enc(project)}/files/mail/${enc(id)}` : null
    },
  },
}

function linked(row: Row, page: Page, callProject: string | null, origin: string): Row {
  if ('url' in row) return row
  const id = page.idOf(row)
  const path = id ? page.path(id, row, callProject) : null
  return path ? { ...row, url: `${origin}${path}` } : row
}

export function withLinks(op: AgentOperation, input: OperationInput, body: unknown, origin: string | null): unknown {
  if (!op.links || !origin) return body
  const page = PAGES[op.links]
  const callProject = callProjectId(op, input)
  const link = (value: unknown) => (isRow(value) ? linked(value, page, callProject, origin) : value)
  if (Array.isArray(body)) return body.map(link)
  if (!isRow(body)) return body
  if (page.idOf(body)) return link(body)
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [key, Array.isArray(value) ? value.map(link) : link(value)]),
  )
}
