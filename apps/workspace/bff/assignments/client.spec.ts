/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { assignPerson, listAssignees, listAssignmentCandidates, releasePerson } from './client'
import { nodesOf, parseSource, productionSources, ts } from '@/test-utils/source-ast'

const ANNA = { userId: 'user_anna', name: 'Anna Berger', email: null, profilePictureUrl: null }

const recorder = (body: unknown, status = 200) => {
  const calls: Array<{ path: string; method: string; body: unknown }> = []
  const run = vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
    return Response.json(body, { status })
  })
  return { run, calls }
}

describe('the assignments client', () => {
  it('reads who is assigned, assigns and releases on the resource’s own path', async () => {
    const { run, calls } = recorder({ assignees: [ANNA] })

    expect(await listAssignees('document', 'doc 1', run)).toEqual([ANNA])
    expect(await assignPerson('document', 'doc 1', 'user_anna', run)).toEqual([ANNA])
    expect(await releasePerson('document', 'doc 1', 'user_anna', run)).toEqual([ANNA])

    expect(calls).toEqual([
      { path: '/api/assignments/document/doc%201', method: 'GET', body: null },
      { path: '/api/assignments/document/doc%201', method: 'POST', body: { userId: 'user_anna' } },
      { path: '/api/assignments/document/doc%201?userId=user_anna', method: 'DELETE', body: null },
    ])
  })

  it('reads the candidates beside them', async () => {
    const { run, calls } = recorder({ candidates: [ANNA] })

    expect(await listAssignmentCandidates('document', 'doc_1', {}, run)).toEqual([ANNA])
    expect(await listAssignmentCandidates('document', 'doc_1', { access: 'write' }, run)).toEqual([ANNA])
    expect(calls.map((call) => call.path)).toEqual([
      '/api/assignments/document/doc_1/candidates',
      '/api/assignments/document/doc_1/candidates?access=write',
    ])
  })

  it('throws on a refusal: a failed read is not „nobody is assigned"', async () => {
    const { run } = recorder({ error: 'Forbidden' }, 403)

    await expect(listAssignees('document', 'doc_1', run)).rejects.toThrow()
    await expect(assignPerson('document', 'doc_1', 'user_anna', run)).rejects.toThrow()
    await expect(listAssignmentCandidates('document', 'doc_1', {}, run)).rejects.toThrow()
  })
})

const UI_DIRS = ['ui/features/', 'ui/components/', 'ui/hooks/', 'ui/adapters/']
const CLIENT = 'bff/assignments/client.ts'
const ASSIGNMENTS_PATH = '/api/assignments'

type TextNode = ts.StringLiteralLike | ts.TemplateHead | ts.TemplateMiddle | ts.TemplateTail

const isTextNode = (node: ts.Node): node is TextNode =>
  ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)

const namesAssignmentsPath = (file: string) =>
  nodesOf(parseSource(file), isTextNode).some((node) => node.text.includes(ASSIGNMENTS_PATH))

describe('the browser reaches the assignments through their client only', () => {
  it('names no /api/assignments path outside the client', () => {
    const uiFiles = productionSources().filter((file) => UI_DIRS.some((dir) => file.startsWith(dir)))
    expect(uiFiles.length).toBeGreaterThan(0)
    expect(namesAssignmentsPath(CLIENT)).toBe(true)

    const offenders = uiFiles.filter(namesAssignmentsPath)
    expect(offenders).toEqual([])
  })
})
