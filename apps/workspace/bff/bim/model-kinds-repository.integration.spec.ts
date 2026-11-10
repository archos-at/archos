/**
 * @vitest-environment node
 *
 * Which model files a turn's project holds, against a REAL Postgres.
 *
 * `projectModelKinds` decides whether the agent is sent `ifc_query`,
 * `ifc_measure` and `dxf_measure` at all. A false "no" takes a tool from a
 * turn that needed it; a file from another project, or another conversation's
 * private upload, counted as "yes" leaks that the file exists. The SQL is the
 * thing under test, so this runs through the restricted runtime role
 * (ADR-0041, `task db:test:rls`), like `model-shelf.integration.spec.ts`.
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/bim/model-kinds-repository.integration.spec.ts
 */

import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const url = process.env.TEST_DATABASE_URL
const ORG = `org_kinds_${Date.now()}`

describe.skipIf(!url)('projectModelKinds', () => {
  let projectModelKinds: typeof import('./model-kinds-repository').projectModelKinds
  let closeDb: typeof import('@/lib/db').closeDb
  let WITH_IFC: string
  let WITH_NOTHING: string
  let OFFICE_ONLY_ORG: string
  const CONVERSATION = `s_kinds_${Date.now()}`
  const OTHER_CONVERSATION = `s_kinds_other_${Date.now()}`

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    const { getDb, closeDb: close } = await import('@/lib/db')
    const { withPlatformAccess } = await import('@/lib/db/tenant-context')
    projectModelKinds = (await import('./model-kinds-repository')).projectModelKinds
    closeDb = close
    const db = getDb()

    const seedProject = async (org: string, name: string): Promise<string> => {
      const rows = await withPlatformAccess('seed a project', () =>
        db.execute<{ id: string }>(sql`
          INSERT INTO projects (organization_id, name, collection_name, created_by)
          VALUES (${org}, ${name}, ${`proj_${name}_${Date.now()}`}, 'seed')
          RETURNING id
        `)
      )
      return Array.from(rows)[0].id
    }
    const seedConversation = async (id: string): Promise<void> => {
      await withPlatformAccess('seed a conversation', () =>
        db.execute(sql`INSERT INTO conversations (id, organization_id, created_by) VALUES (${id}, ${ORG}, 'seed')`)
      )
    }
    const seedDocument = async (input: {
      org?: string
      filename: string
      scope: 'project' | 'office_shelf' | 'session'
      projectId: string | null
      conversationId: string | null
      status?: string
    }): Promise<void> => {
      await withPlatformAccess('seed a document', () =>
        db.execute(sql`
          INSERT INTO documents
            (organization_id, created_by, filename, storage_key, collection_name, status,
             scope, project_id, conversation_id)
          VALUES
            (${input.org ?? ORG}, 'seed', ${input.filename}, ${`seed/${input.filename}`}, 'seed',
             ${input.status ?? 'completed'}, ${input.scope}, ${input.projectId}::uuid, ${input.conversationId})
        `)
      )
    }

    WITH_IFC = await seedProject(ORG, 'with-ifc')
    WITH_NOTHING = await seedProject(ORG, 'with-nothing')
    await seedConversation(CONVERSATION)
    await seedConversation(OTHER_CONVERSATION)
    await seedDocument({ filename: 'Haus.IFC', scope: 'project', projectId: WITH_IFC, conversationId: null })
    await seedDocument({ filename: 'Grundriss.pdf', scope: 'project', projectId: WITH_NOTHING, conversationId: null })
    // A quarantined DXF is held from the agent (ADR-0086): it must not count.
    await seedDocument({
      filename: 'gesperrt.dxf',
      scope: 'project',
      projectId: WITH_NOTHING,
      conversationId: null,
      status: 'quarantined',
    })
    // Another conversation's private upload must not count for this one.
    await seedDocument({ filename: 'privat.dxf', scope: 'session', projectId: null, conversationId: OTHER_CONVERSATION })

    OFFICE_ONLY_ORG = `${ORG}_office`
    await seedDocument({
      org: OFFICE_ONLY_ORG,
      filename: 'Lageplan.dxf',
      scope: 'office_shelf',
      projectId: null,
      conversationId: null,
    })
  })

  afterAll(async () => {
    await closeDb?.()
  })

  it('names the kind a project holds, whatever the extension case', async () => {
    expect(await projectModelKinds(ORG, WITH_IFC, CONVERSATION)).toEqual({ ifc: true, dxf: false })
  })

  it('does not count another project, a held file or another conversation', async () => {
    expect(await projectModelKinds(ORG, WITH_NOTHING, CONVERSATION)).toEqual({ ifc: false, dxf: false })
  })

  it("counts this conversation's own upload", async () => {
    expect(await projectModelKinds(ORG, WITH_NOTHING, OTHER_CONVERSATION)).toEqual({ ifc: false, dxf: true })
  })

  it('counts the office shelf, and only its own organization', async () => {
    const project = WITH_NOTHING
    expect(await projectModelKinds(OFFICE_ONLY_ORG, project, null)).toEqual({ ifc: false, dxf: true })
  })
})
