// @disk-inputs: app/**, bff/**, i18n.ts, i18n.tsx, i18n/**, shared/**, test-utils.ts, test-utils.tsx, tests/fixtures/backend-tools.schema.json.ts, tests/fixtures/backend-tools.schema.json.tsx, tests/fixtures/backend-tools.schema.json/index.ts, tests/fixtures/backend-tools.schema.json/index.tsx, tests/mocks/server.ts, tests/test-utils/index.ts, tests/test-utils/index.tsx, types/**, ui/**, utils/**, workers/app-database.js.ts, workers/app-database.js.tsx, workers/app-database.js/index.ts, workers/app-database.js/index.tsx, workers/database-unavailable.js.ts, workers/database-unavailable.js.tsx, workers/database-unavailable.js/index.ts, workers/database-unavailable.js/index.tsx, workers/job-queue.js.ts, workers/job-queue.js.tsx, workers/job-queue.js/index.ts, workers/job-queue.js/index.tsx, workers/langfuse-traces.js.ts, workers/langfuse-traces.js.tsx, workers/langfuse-traces.js/index.ts, workers/langfuse-traces.js/index.tsx, workers/maintenance-sql.js.ts, workers/maintenance-sql.js.tsx, workers/maintenance-sql.js/index.ts, workers/maintenance-sql.js/index.tsx
/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { callsTo, nodesOf, parseSource, parseSourceText, ts } from '@/test-utils/source-ast'
import { CALLERS, OBJECT_READERS, ROUTE_FILES, functionsInSource, type TopLevelFunction } from './coverage.fixtures'

const functionsIn = (rel: string, text: string) => functionsInSource(parseSourceText(text, rel))

const ROUTE_KEY = (file: string): string => relative(join(process.cwd(), 'app', 'api'), file).replace(/\\/g, '/')

type RouteDisposition = { via: string } | { exempt: string }

const ROUTES: Record<string, RouteDisposition> = {
  'documents/[id]/download/route.ts': { via: 'getDocumentDownload' },
  'documents/[id]/preview/route.ts': { via: 'getDocumentPreview' },
  'documents/[id]/file/route.ts': { via: 'streamDocumentFile' },
  'documents/[id]/text/route.ts': { via: 'getDocumentTextPreview' },
  'documents/[id]/versions/[versionId]/content/route.ts': { via: 'readVersionContent' },
  'documents/[id]/versions/diff/route.ts': { via: 'readVersionContent' },
  'bim/models/[modelId]/source/route.ts': { via: 'getModelSource' },
  'documents/[id]/thumbnail/route.ts': { exempt: 'a thumbnail, see OBJECT_READERS.getDocumentThumbnail' },
  'documents/[id]/image/route.ts': { exempt: 'signed capability URL with no session, see OBJECT_READERS.streamDocumentImage' },
  'projects/[id]/bim/checks/export/route.ts': { exempt: 'a BCF file generated from rule checks; it holds no stored document.' },
  'platform/answer-feedback/export/route.ts': { exempt: 'platform feedback export for the platform owner; no tenant document.' },
  'platform/citation-health/export/route.ts': { exempt: 'platform citation statistics export; no tenant document.' },
  'conversations/[id]/messages/[messageId]/export/route.ts': {
    exempt: 'renders one chat answer as a document; it is not a stored file, and the answer is the conversation’s own content.',
  },
  'documents/[id]/annotations/export/route.ts': {
    exempt: 'renders the document’s Anmerkungen and their threads as a Protokoll; none of the document’s bytes, and the audit event document.annotations.exported records it.',
  },
  'projects/[id]/annotations/export/route.ts': {
    exempt: 'renders the open Anmerkungen of a project’s documents and their threads as one Protokoll; none of a document’s bytes, and the audit event project.annotations.exported records it.',
  },
  'search/export/route.ts': {
    exempt: 'renders the documents a search finds as a Planliste (names, Plankopf facts, dates); none of a document’s bytes, and the audit event search.plan_list.exported records it.',
  },
  'conversations/[id]/live/route.ts': { exempt: 'server-sent events of a conversation.' },
  'stream/route.ts': { exempt: 'server-sent events.' },
  'realtime/route.ts': { exempt: 'server-sent events of the live channels (lib/realtime): presence, pointers and change hints; no file bytes.' },
  'health/route.ts': { exempt: 'the health probe; no files.' },
  'mcp/route.ts': {
    exempt:
      'the MCP server hands file bytes only by running the person-facing route that serves them (lib/agent-api/dispatch.ts calls its exported handler in-process), so the bytes pass through that route and its logged function, which records the hand-over as the person.',
  },
  'a2a/route.ts': {
    exempt:
      'the A2A server answers with JSON-RPC text: an ask, its answer text and the names of documents the agent filed, read through the ask routes as the person (lib/a2a/request-handler.ts); it never hands a file’s bytes.',
  },
  'v1/[...path]/route.ts': { exempt: 'proxy of the allowlisted JSON endpoints of the agent service (lib/proxy/v1-allowlist); no file bytes.' },
  'knowledge-base/documents/[fileName]/route.ts': { exempt: 'the platform’s shared knowledge base (norms), served from the agent service; not an organization’s document.' },
  'platform/knowledge/documents/[fileName]/route.ts': { exempt: 'the platform operator’s read of the same shared knowledge base, released or not; not an organization’s document.' },
  'internal/document-file/route.ts': { exempt: 'agent service only: tells it where an object is; it fetches the object itself for a turn.' },
  'internal/bim/source/route.ts': { exempt: 'agent service only: a presigned IFC for the model tool.' },
  'internal/document-versions/[versionId]/content/route.ts': { exempt: 'agent service only: opens a turn’s subject into its working directory.' },
}

describe('download log coverage: routes', () => {
  const calledAs = (name: string): string => name.slice(name.lastIndexOf('.') + 1).replace(/^(static )?([gs]et )?/, '')

  const seeds = new Set(
    Object.entries(OBJECT_READERS)
      .filter(([, disposition]) => 'logged' in disposition || ('servesPerson' in disposition && disposition.servesPerson))
      .map(([key]) => calledAs(key.split('::')[1]))
  )

  function reaching(functions: readonly TopLevelFunction[] = CALLERS): Set<string> {
    const names = new Set(seeds)
    for (let grew = true; grew; ) {
      grew = false
      for (const fn of functions) {
        const name = calledAs(fn.name)
        if (/^app\/api\/.*route\.ts$/.test(fn.file) || names.has(name)) continue
        if ([...fn.identifiers].some((identifier) => identifier !== name && names.has(identifier))) {
          names.add(name)
          grew = true
        }
      }
    }
    return names
  }

  const RAW_RESPONSE_CONSTRUCTORS = new Set(['Response', 'NextResponse'])
  const RAW_BYTE_STREAMS = new Set(['streamKnowledgeBaseDocumentFor', 'streamKnowledgeBaseDocumentAsPlatform'])

  function handsRawResponse(source: ts.SourceFile): boolean {
    return (
      nodesOf(source, ts.isNewExpression).some(
        (node) => ts.isIdentifier(node.expression) && RAW_RESPONSE_CONSTRUCTORS.has(node.expression.text)
      ) || nodesOf(source, ts.isIdentifier).some((node) => RAW_BYTE_STREAMS.has(node.text))
    )
  }

  function detectedRoutes(): string[] {
    const names = reaching()
    return ROUTE_FILES.filter((file) => {
      const source = parseSource(file)
      return handsRawResponse(source) || nodesOf(source, ts.isIdentifier).some((node) => names.has(node.text))
    })
      .map(ROUTE_KEY)
      .sort()
  }

  it('follows a member by the name a caller writes for it, a getter and a static member too', () => {
    const names = reaching(
      functionsIn(
        'lib/example.ts',
        `
        export class Files {
          static async open(session, id) { return getDocumentDownload(session, id) }
          get original() { return getDocumentPreview(this.session, this.id) }
        }
        `
      )
    )
    expect(['open', 'original'].filter((name) => !names.has(name))).toEqual([])
  })

  it('finds the route surface', () => {
    expect(ROUTE_FILES.length).toBeGreaterThan(100)
  })

  it('lists every route that reaches a logged function, serves a thumbnail or image, or builds a raw Response', () => {
    const listed = new Set(Object.keys(ROUTES))
    const missing = detectedRoutes().filter((route) => !listed.has(route))
    expect(
      missing,
      'These routes can hand file bytes to a person and are not in ROUTES. Name the logged function they go ' +
        'through (`via`), or exempt them with the reason.'
    ).toEqual([])
  })

  it('the detection sees the routes that go through a logged function (it is not vacuous)', () => {
    const detected = new Set(detectedRoutes())
    const logged = Object.entries(ROUTES)
      .filter(([, disposition]) => 'via' in disposition)
      .map(([route]) => route)
    expect(logged.filter((route) => !detected.has(route))).toEqual([])
  })

  it('every listed route exists and names a function it really reaches', () => {
    for (const [route, disposition] of Object.entries(ROUTES)) {
      const file = join(process.cwd(), 'app', 'api', route)
      expect(existsSync(file), route).toBe(true)
      if ('via' in disposition) {
        expect(callsTo(parseSource(file), disposition.via), `${route} must call ${disposition.via}`).not.toHaveLength(0)
        const target = Object.entries(OBJECT_READERS).find(
          ([key, entry]) => key.endsWith(`::${disposition.via}`) && 'logged' in entry
        )
        expect(target, `${route} goes through ${disposition.via}, which must be a logged function`).toBeDefined()
      } else {
        expect(disposition.exempt.length, route).toBeGreaterThan(15)
      }
    }
  })
})
