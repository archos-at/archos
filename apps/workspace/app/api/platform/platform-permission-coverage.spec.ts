// @disk-inputs: app/api/platform/**
/**
 * @vitest-environment node
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'

vi.mock('server-only', () => ({}))

const GATE = vi.hoisted(() => ({ asked: [] as string[], handlerReached: [] as string[] }))

const SESSION = vi.hoisted(() => ({
  userId: 'user_1',
  organizationId: 'org_1',
  email: 'owner@example.test',
  permissions: [] as string[],
}))

vi.mock('@/lib/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/session')>()),
  getUserSession: async () => SESSION,
}))

vi.mock('@/lib/authz/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/authz/platform')>()
  return {
    ...actual,
    requirePlatformPermission: async (_session: unknown, permission: string) => {
      GATE.asked.push(permission)
      throw new actual.PlatformAccessDeniedError(`Platform permission required: ${permission}`)
    },
  }
})

vi.mock('@/lib/db/tenant-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db/tenant-context')>()
  return {
    ...actual,
    withPlatformAccess: async (reason: string) => {
      GATE.handlerReached.push(reason)
      throw new Error(`handler ran without a platform gate: ${reason}`)
    },
  }
})

const EXPECTED: Record<string, string> = {
  'audit-portal/route.ts POST': 'organizationsView',
  'cards/route.ts GET': 'settingsView',
  'citation-health/export/route.ts GET': 'organizationsView',
  'citation-health/route.ts GET': 'organizationsView',
  'feedback/[reportId]/route.ts GET': 'settingsView',
  'feedback/[reportId]/route.ts PATCH': 'settingsManage',
  'feedback/route.ts GET': 'settingsView',
  'feedback/claim/route.ts POST': 'settingsManage',
  'knowledge/documents/[fileName]/display-title/route.ts PATCH': 'knowledgeWrite',
  'knowledge/documents/[fileName]/doc-class/route.ts PATCH': 'knowledgeWrite',
  'knowledge/documents/[fileName]/route.ts DELETE': 'knowledgeWrite',
  'knowledge/documents/[fileName]/route.ts GET': 'settingsView',
  'knowledge/documents/route.ts GET': 'settingsView',
  'knowledge/documents/route.ts POST': 'knowledgeWrite',
  'knowledge/route.ts GET': 'settingsView',
  'knowledge/change-requests/route.ts GET': 'settingsView',
  'knowledge/change-requests/route.ts POST': 'knowledgeWrite',
  'knowledge/change-requests/[changeRequestId]/route.ts GET': 'settingsView',
  'knowledge/change-requests/[changeRequestId]/records/route.ts POST': 'knowledgeWrite',
  'knowledge/change-requests/[changeRequestId]/territories/route.ts POST': 'knowledgeWrite',
  'knowledge/change-requests/[changeRequestId]/captures/route.ts POST': 'knowledgeWrite',
  'knowledge/change-requests/[changeRequestId]/texts/[manifestationKey]/route.ts GET': 'settingsView',
  'knowledge/change-requests/[changeRequestId]/texts/route.ts POST': 'knowledgeWrite',
  'knowledge/change-requests/[changeRequestId]/texts/upload/route.ts POST': 'knowledgeWrite',
  'knowledge/texts/route.ts GET': 'settingsView',
  'knowledge/countries/[countryId]/works/route.ts GET': 'settingsView',
  'knowledge/countries/[countryId]/documents/route.ts POST': 'knowledgeWrite',
  'knowledge/countries/[countryId]/documents/upload/route.ts POST': 'knowledgeWrite',
  'knowledge/sources/route.ts GET': 'settingsView',
  'knowledge/sources/[sourceKey]/test/route.ts POST': 'knowledgeWrite',
  'knowledge/sources/[sourceKey]/credential/route.ts PUT': 'knowledgeWrite',
  'knowledge/change-requests/[changeRequestId]/validation/route.ts GET': 'settingsView',
  'knowledge/releases/[countryId]/route.ts GET': 'knowledgeReview',
  'knowledge/releases/route.ts POST': 'knowledgeWrite',
  'knowledge/schemas/route.ts GET': 'settingsView',
  'knowledge/change-requests/[changeRequestId]/submit/route.ts POST': 'knowledgeWrite',
  'knowledge/change-requests/[changeRequestId]/review/route.ts POST': 'knowledgeReview',
  'knowledge/change-requests/[changeRequestId]/decision/route.ts POST': 'knowledgeReview',
  'knowledge/change-requests/[changeRequestId]/publish/route.ts POST': 'knowledgeReview',
  'knowledge/change-requests/[changeRequestId]/rollback/route.ts POST': 'knowledgeReview',
  'knowledge/change-requests/[changeRequestId]/index-status/route.ts GET': 'settingsView',
  'knowledge/golden-runs/route.ts POST': 'knowledgeWrite',
  'knowledge/golden-runs/[runId]/advance/route.ts POST': 'knowledgeWrite',
  'knowledge/golden-runs/[runId]/route.ts GET': 'settingsView',
  'organizations/[organizationId]/countries/route.ts POST': 'organizationsManage',
  'organizations/countries/route.ts GET': 'organizationsView',
  'organizations/[organizationId]/home-country/route.ts PUT': 'organizationsManage',
  'knowledge/reingest/route.ts POST': 'knowledgeWrite',
  'knowledge/sync/route.ts POST': 'knowledgeWrite',
  'lessons/[lessonId]/route.ts GET': 'settingsView',
  'lessons/[lessonId]/route.ts PATCH': 'settingsManage',
  'lessons/route.ts GET': 'settingsView',
  'lessons/route.ts POST': 'settingsManage',
  'maintenance/kill-runs/route.ts POST': 'settingsManage',
  'maintenance/reconcile-vectors/route.ts POST': 'settingsManage',
  'model-defaults/models/route.ts GET': 'settingsView',
  'model-defaults/route.ts GET': 'settingsView',
  'model-defaults/route.ts PUT': 'settingsManage',
  'norms/route.ts GET': 'settingsView',
  'norms/route.ts PUT': 'settingsManage',
  'norms/verify/route.ts POST': 'settingsManage',
  'organizations/[organizationId]/storage/route.ts GET': 'organizationsView',
  'organizations/[organizationId]/storage/route.ts PUT': 'organizationsManage',
  'organizations/[organizationId]/upload-limit/route.ts PUT': 'organizationsManage',
  'organizations/[organizationId]/budgets/route.ts GET': 'organizationsView',
  'organizations/[organizationId]/budgets/route.ts PUT': 'organizationsManage',
  'organizations/[organizationId]/usage/route.ts GET': 'usageView',
  'overview/route.ts GET': 'organizationsView',
  'pricing/route.ts GET': 'settingsView',
  'pricing/route.ts PUT': 'settingsManage',
  'profiler/conversations/[conversationId]/route.ts GET': 'organizationsView',
  'profiler/conversations/route.ts GET': 'organizationsView',
  'quality/scope-options/route.ts GET': 'organizationsView',
  'reasoning-efforts/route.ts GET': 'settingsView',
  'reasoning-efforts/route.ts PUT': 'settingsManage',
  'retrieval-settings/route.ts GET': 'settingsView',
  'retrieval-settings/route.ts PUT': 'settingsManage',
  'skill-categories/[categoryId]/route.ts PATCH': 'settingsManage',
  'skill-categories/[categoryId]/route.ts DELETE': 'settingsManage',
  'skill-categories/route.ts GET': 'settingsView',
  'skill-categories/route.ts POST': 'settingsManage',
  'skills/[skillId]/route.ts PATCH': 'settingsManage',
  'skills/[skillId]/route.ts DELETE': 'settingsManage',
  'skills/route.ts GET': 'settingsView',
  'skills/route.ts POST': 'settingsManage',
  'storage/route.ts GET': 'organizationsView',
}

const DOORS = new Set(['mcp/route.ts'])

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
type HttpMethod = (typeof HTTP_METHODS)[number]
const MUTATING: readonly HttpMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE']

const ROUTE_MODULES = import.meta.glob<Record<string, unknown>>([
  './**/route.ts',
  '!./answer-feedback/**',
])

const PERMISSION_NAME = new Map<string, string>(
  Object.entries(PLATFORM_PERMISSIONS).map(([name, value]) => [value, name])
)

type Handler = (request: Request) => Promise<Response>

interface Declaration {
  key: string
  file: string
  method: HttpMethod
  handler: Handler
}

async function collect(): Promise<Declaration[]> {
  const declarations: Declaration[] = []
  for (const [specifier, load] of Object.entries(ROUTE_MODULES)) {
    const file = specifier.slice(2)
    if (DOORS.has(file)) continue
    const route = await load()
    for (const method of HTTP_METHODS) {
      const handler = route[method]
      if (typeof handler === 'function') {
        declarations.push({ key: `${file} ${method}`, file, method, handler: handler as Handler })
      }
    }
  }
  return declarations
}

async function probe(declaration: Declaration): Promise<string | null> {
  GATE.asked.length = 0
  GATE.handlerReached.length = 0
  await declaration.handler(
    new Request(`http://localhost/api/platform/${declaration.file}`, { method: declaration.method })
  )
  return GATE.asked.at(-1) ?? null
}

let DECLARATIONS: Declaration[] = []
const ASKED = new Map<string, string | null>()

beforeAll(async () => {
  DECLARATIONS = await collect()
  for (const declaration of DECLARATIONS) {
    ASKED.set(declaration.key, await probe(declaration))
  }
}, 120_000)

function askedName(key: string): string {
  const permission = ASKED.get(key)
  if (!permission) return 'NOTHING'
  return PERMISSION_NAME.get(permission) ?? permission
}

describe('platform route permissions', () => {
  it('finds the platform route surface (a broken walk must not pass vacuously)', () => {
    expect(DECLARATIONS.length).toBeGreaterThan(25)
  })

  it('every factory-gated platform handler asks the gate for the permission this table names', () => {
    const wrong = DECLARATIONS.filter((d) => askedName(d.key) !== EXPECTED[d.key]).map(
      (d) => `${d.key}: gated on ${askedName(d.key)}, table says ${EXPECTED[d.key] ?? 'UNLISTED'}`
    )

    expect(
      wrong,
      'A platform route changed the permission it requires. If that is intended, ' +
        'update EXPECTED in this file — a widening should be a diff somebody reads.'
    ).toEqual([])
  })

  it('the table has no rows for routes that no longer exist', () => {
    const live = new Set(DECLARATIONS.map((d) => d.key))
    expect([...Object.keys(EXPECTED)].filter((key) => !live.has(key))).toEqual([])
  })

  it('no route that WRITES is gated on a view permission', () => {
    const readGated = DECLARATIONS.filter((d) => MUTATING.includes(d.method))
      .filter((d) => ASKED.get(d.key)?.endsWith(':view'))
      .filter((d) => !['audit-portal/route.ts POST', 'norms/verify/route.ts POST'].includes(d.key))
      .map((d) => d.key)

    expect(readGated).toEqual([])
  })
})
