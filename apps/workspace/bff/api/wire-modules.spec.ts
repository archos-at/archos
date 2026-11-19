// @disk-inputs: bff/**
/**
 * @vitest-environment node
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'

const TOUCHED = vi.hoisted(() => [] as string[])

const WIRE_MODULES = Object.entries(import.meta.glob<unknown>('../**/*-wire.ts'))
const SERVICE_AND_REPOSITORY_MODULES = Object.keys(
  import.meta.glob<unknown>([
    '../**/service.ts',
    '../**/repository.ts',
    '../**/service/index.ts',
    '../**/repository/index.ts',
  ]),
)
const FORBIDDEN = ['@/lib/db', '@/lib/db/schema', 'server-only']

beforeAll(() => {
  for (const specifier of [...FORBIDDEN, ...SERVICE_AND_REPOSITORY_MODULES]) {
    vi.doMock(specifier, () => {
      TOUCHED.push(specifier)
      return {}
    })
  }
})

describe('wire modules', () => {
  it('finds the wire modules (a broken glob must not pass vacuously)', () => {
    const files = WIRE_MODULES.map(([file]) => file)
    expect(files).toContain('../projects/project-wire.ts')
    expect(files).toContain('../conversations/conversation-wire.ts')
  })

  it('import no database layer, service, repository or server-only module', async () => {
    const offenders: string[] = []
    for (const [file, load] of WIRE_MODULES) {
      TOUCHED.length = 0
      await load()
      offenders.push(...TOUCHED.map((specifier) => `${file}: ${specifier}`))
    }
    expect(offenders).toEqual([])
  })
})
