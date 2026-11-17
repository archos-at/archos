// @disk-inputs: app/api/platform/**
/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const PLATFORM_DIR = dirname(fileURLToPath(import.meta.url))

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

const SERVICE_ENFORCED = new Set([
  'answer-feedback/route.ts',
  'answer-feedback/digest/route.ts',
  'answer-feedback/export/route.ts',
  'answer-feedback/options/route.ts',
])

const DOORS = new Set(['mcp/route.ts'])

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

function findRouteFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...findRouteFiles(path))
    else if (entry.name === 'route.ts') found.push(path)
  }
  return found
}

interface Declaration {
  key: string
  file: string
  permission: string | null
}

function collect(): Declaration[] {
  const declarations: Declaration[] = []
  for (const absolute of findRouteFiles(PLATFORM_DIR)) {
    const file = relative(PLATFORM_DIR, absolute).replace(/\\/g, '/')
    if (DOORS.has(file)) continue
    const source = readFileSync(absolute, 'utf8')
    for (const method of HTTP_METHODS) {
      const start = source.indexOf(`export const ${method} =`)
      if (start < 0) continue
      const rest = source.slice(start + 1)
      const next = rest.search(/\nexport const [A-Z]+\s*=/)
      const segment = next >= 0 ? rest.slice(0, next) : rest
      const matched = /permission:\s*PLATFORM_PERMISSIONS\.(\w+)/.exec(segment)
      declarations.push({
        key: `${file} ${method}`,
        file,
        permission: matched?.[1] ?? null,
      })
    }
  }
  return declarations
}

const DECLARATIONS = collect()

describe('platform route permissions', () => {
  it('finds the platform route surface (a broken walk must not pass vacuously)', () => {
    expect(DECLARATIONS.length).toBeGreaterThan(25)
  })

  it('every factory-gated platform handler declares the permission this table names', () => {
    const wrong = DECLARATIONS.filter((d) => !SERVICE_ENFORCED.has(d.file))
      .filter((d) => d.permission !== EXPECTED[d.key])
      .map(
        (d) =>
          `${d.key}: declares ${d.permission ?? 'NOTHING'}, table says ${EXPECTED[d.key] ?? 'UNLISTED'}`
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
    const mutating = DECLARATIONS.filter(
      (d) => !SERVICE_ENFORCED.has(d.file) && /(POST|PUT|PATCH|DELETE)$/.test(d.key)
    )
    const readGated = mutating
      .filter((d) => d.permission?.endsWith('View'))
      .filter((d) => !['audit-portal/route.ts POST', 'norms/verify/route.ts POST'].includes(d.key))
      .map((d) => d.key)

    expect(readGated).toEqual([])
  })
})
