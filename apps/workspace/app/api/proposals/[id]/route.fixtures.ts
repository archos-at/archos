import { vi } from 'vitest'

import { NotFoundError } from '@/lib/api/errors'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { ProjectMemoryItem } from '@/lib/db/schema/project-memory'

import { GET } from './route'
import { POST as apply } from './apply/route'
import { POST as dismiss } from './dismiss/route'

type Handler = (request: Request, context?: { params?: Promise<Record<string, string>> }) => Promise<Response>

const ROUTES: Array<{ pattern: RegExp; method: string; handler: Handler }> = [
  { pattern: /^\/api\/proposals\/([^/]+)$/, method: 'GET', handler: GET },
  { pattern: /^\/api\/proposals\/([^/]+)\/apply$/, method: 'POST', handler: apply },
  { pattern: /^\/api\/proposals\/([^/]+)\/dismiss$/, method: 'POST', handler: dismiss },
]

export const run = async (path: string, init?: RequestInit) => {
  const url = new URL(path, 'https://example.test')
  const method = init?.method ?? 'GET'
  const route = ROUTES.find((entry) => entry.pattern.test(url.pathname) && entry.method === method)
  if (!route) throw new Error(`no route for ${method} ${url.pathname}`)
  const matched = route.pattern.exec(url.pathname) as RegExpExecArray
  return route.handler(new Request(url, init), { params: Promise.resolve({ id: decodeURIComponent(matched[1]) }) })
}

export const readOnly = () =>
  vi.mocked(requireProjectAccess).mockImplementation(async (_session, _project, permission) => {
    if (permission === 'project:view') return { role: 'project-viewer', closed: false, readsBecauseClosed: false }
    throw new NotFoundError()
  })

export const memoryItem = (id: string) => ({ id }) as Partial<ProjectMemoryItem> as ProjectMemoryItem
