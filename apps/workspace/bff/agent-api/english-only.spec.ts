// @disk-inputs: ../../ci/german_stems.json, app/api/mcp/**, bff/agent-api/**
/**
 * @vitest-environment node
 */

import { webcrypto } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMcpHandler } from '@modelcontextprotocol/server'
import ts from 'typescript-api'
import { beforeAll, describe, expect, it } from 'vitest'
import { germanProseWords } from '@/test-utils/german-words'
import { AGENT_OPERATIONS } from './catalog'
import { buildMcpServer } from './mcp-server'
import { isExposedTo } from './exposure'
import { buildOpenApiDocument } from './openapi'
import { sensitiveProposalRefusal } from './operation-proposals'
import type { AgentPrincipal } from './principal'
import { READ_REFUSALS } from './conversation-audience'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../..')
const SURFACE_DIRS = ['bff/agent-api', 'app/api/mcp']

const DOMAIN_DATA: readonly { text: string; reason: string }[] = [
  { text: 'OIB-Richtlinie', reason: 'the published title of the OIB guidelines, a legal citation' },
  { text: 'ÖNORM', reason: 'the prefix of an Austrian standard’s designation (ÖNORM B 1600), a citation' },
]

interface Found {
  where: string
  text: string
}

function strings(value: unknown, where: string, into: Found[]): Found[] {
  if (typeof value === 'string') into.push({ where, text: value })
  else if (Array.isArray(value)) value.forEach((item, index) => strings(item, `${where}[${index}]`, into))
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) strings(item, `${where}.${key}`, into)
  }
  return into
}

function germanIn(found: readonly Found[]): string[] {
  return found.flatMap(({ where, text }) => {
    const scrubbed = DOMAIN_DATA.reduce((rest, { text: data }) => rest.split(data).join(''), text)
    const words = germanProseWords(scrubbed)
    return words.length > 0 ? [`${where}: ${[...new Set(words)].join(', ')}`] : []
  })
}

const principal: AgentPrincipal = {
  actor: 'external_agent',
  clientId: 'c',
  scopes: ['piloti:sensitive'],
  sensitiveOptIns: ['access', 'secret'],
  session: {
    userId: 'user_1',
    email: 'a@piloti.test',
    name: null,
    accessToken: '',
    organizationId: 'org_1',
    organizationMembershipId: 'om_1',
    role: 'admin',
    permissions: [],
    featureFlags: null,
  },
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
})

async function rpc(mode: 'search' | 'tools', method: string, params: Record<string, unknown>): Promise<unknown> {
  const handler = createMcpHandler(() => buildMcpServer(principal, mode), { responseMode: 'json' })
  const response = await handler.fetch(
    new Request('https://x.test/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  )
  const raw = await response.text()
  const data = raw.split('\n').find((line) => line.startsWith('data:'))
  return (JSON.parse(data ? data.slice(5) : raw) as { result: unknown }).result
}

const INITIALIZE = {
  protocolVersion: '2025-11-25',
  capabilities: {},
  clientInfo: { name: 'english-only.spec', version: '1' },
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name) ? [path] : []
  })
}

function literalsOf(file: string): Found[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const name = relative(SRC, file)
  const found: Found[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push({ where: `${name}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`, text: node.text })
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
      found.push({ where: `${name}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`, text: parts.join(' ') })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('everything an agent reads is English', () => {
  it('tells German from English the way the checks need', () => {
    expect(germanProseWords('Read the project record')).toEqual([])
    expect(germanProseWords('Read the Steckbrief')).toEqual(['Steckbrief'])
    expect(germanProseWords('the Büroablage')).toEqual(['Büroablage'])
    expect(germanProseWords('Neue Aufgabe anlegen')).toEqual(['Aufgabe'])
    expect(germanProseWords('archived items')).toEqual([])
  })

  it('in the server instructions and every tool of search mode', async () => {
    const found = [
      ...strings(await rpc('search', 'initialize', INITIALIZE), 'initialize', []),
      ...strings(await rpc('search', 'tools/list', {}), 'search/tools', []),
    ]
    expect(found.length).toBeGreaterThan(10)
    expect(germanIn(found)).toEqual([])
  })

  it('in every tool of tools mode: names, titles, descriptions and input schemas', async () => {
    const listed = (await rpc('tools', 'tools/list', {})) as { tools: { name: string }[] }
    const offered = AGENT_OPERATIONS.filter((op) => isExposedTo('external', op.name) && !op.sensitivity).length
    expect(listed.tools.length).toBeGreaterThan(offered)
    expect(germanIn(strings(listed, 'tools', []))).toEqual([])
  })

  it('in the OpenAPI document', () => {
    const document = buildOpenApiDocument(AGENT_OPERATIONS, { serverUrl: 'https://piloti.example' })
    expect(germanIn(strings(document, 'openapi', []))).toEqual([])
  })

  it('in the refusals the model reads', () => {
    const found: Found[] = [
      ...Object.entries(READ_REFUSALS).map(([key, text]) => ({ where: `READ_REFUSALS.${key}`, text })),
      { where: 'sensitiveProposalRefusal', text: sensitiveProposalRefusal({ name: 'organization-role-create' }) },
    ]
    expect(germanIn(found)).toEqual([])
  })

  it('in every string literal of the agent surface’s own source', () => {
    const found = SURFACE_DIRS.flatMap((dir) => sourceFiles(join(SRC, dir))).flatMap(literalsOf)
    expect(found.length).toBeGreaterThan(500)
    expect(germanIn(found)).toEqual([])
  })

  it('keeps every domain-data exception narrow and explained', () => {
    for (const { text, reason } of DOMAIN_DATA) {
      expect(text.length, text).toBeGreaterThan(2)
      expect(reason.length, text).toBeGreaterThan(20)
    }
  })
})
