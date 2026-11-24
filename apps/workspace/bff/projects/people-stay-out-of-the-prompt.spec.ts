/**
 * @vitest-environment node
 *
 * The Steckbrief's people never reach the agent (ADR-0091). They are personal
 * data of people who mostly never gave it — former staff, external planners —
 * and the agent's context is sent to a model on every turn.
 *
 * Kept out by construction: the people live in their own table, and nothing
 * that assembles what the agent is told may load it. This spec imports every
 * module that builds the agent's context, and the agent's own service-token
 * routes, and fails if loading one of them loads the people's table or service.
 * A new context builder belongs in the glob below.
 */
import { describe, expect, it, vi } from 'vitest'

const loaded = vi.hoisted(() => new Set<string>())

vi.mock('@/lib/db/schema/project-people', async (importOriginal) => {
  loaded.add('@/lib/db/schema/project-people')
  return importOriginal()
})
vi.mock('@/lib/projects/project-record-repository', async (importOriginal) => {
  loaded.add('@/lib/projects/project-record-repository')
  return importOriginal()
})
vi.mock('@/lib/projects/project-record-service', async (importOriginal) => {
  loaded.add('@/lib/projects/project-record-service')
  return importOriginal()
})

const CONTEXT_BUILDERS = import.meta.glob<Record<string, unknown>>([
  '../project-profile/**/*.{ts,tsx}',
  '../turn-context/**/*.{ts,tsx}',
  '../cross-project/**/*.{ts,tsx}',
  '../../app/api/internal/**/*.{ts,tsx}',
  '../../app/api/auth/websocket-scope/*.{ts,tsx}',
  '../retrieval-scope/collection-scope-request.ts',
  '../jobs/service.ts',
  '../tasks/delegation.ts',
  '!../project-profile/**/*.{spec,test}.{ts,tsx}',
  '!../turn-context/**/*.{spec,test}.{ts,tsx}',
  '!../cross-project/**/*.{spec,test}.{ts,tsx}',
  '!../../app/api/internal/**/*.{spec,test}.{ts,tsx}',
  '!../../app/api/auth/websocket-scope/*.{spec,test}.{ts,tsx}',
])

describe("the project record's people stay out of the agent's prompt", () => {
  it('loading no module that builds the agent context, nor any agent route, loads them', async () => {
    const offenders: Record<string, string[]> = {}
    for (const [file, load] of Object.entries(CONTEXT_BUILDERS)) {
      const before = new Set(loaded)
      await load()
      const reached = [...loaded].filter((id) => !before.has(id))
      if (reached.length > 0) offenders[file] = reached
    }
    expect(offenders).toEqual({})
  })

  it('the recorder sees the people table when it is loaded', async () => {
    await import('@/lib/db/schema/project-people')
    expect(loaded.has('@/lib/db/schema/project-people')).toBe(true)
  })
})
