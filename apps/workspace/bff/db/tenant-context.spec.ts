// @vitest-environment node
// @disk-inputs: app/api/**, bff/agent-api/mcp-door-route.ts, bff/api/handler.ts, bff/api/platform-handler.ts, bff/db/tenant-context.ts

import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import http from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  MissingTenantContextError,
  enterTenantContext,
  getTenantContext,
  requireTenantContext,
  runWithTenantSlot,
  withOptionalTenant,
  withPlatformAccess,
  withTenant,
} from './tenant-context'

async function overOneSocket(
  onRequest: (path: string) => Promise<void> | void,
  observe: () => string | null,
  paths: string[]
): Promise<Array<{ path: string; seen: string | null }>> {
  const seen: Array<{ path: string; seen: string | null }> = []
  const server = http.createServer(async (req, res) => {
    seen.push({ path: req.url ?? '', seen: observe() })
    await onRequest(req.url ?? '')
    res.end('ok')
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as { port: number }
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })

  try {
    for (const path of paths) {
      await new Promise<void>((resolve, reject) => {
        const request = http.get({ port, path, agent }, (res) => {
          res.resume()
          res.on('end', resolve)
        })
        request.on('error', reject)
      })
    }
  } finally {
    agent.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  return seen
}

describe('runWithTenantSlot', () => {
  it('does not leak a tenant to the next request on the same socket', async () => {
    const seen = await overOneSocket(
      async (path) => {
        await runWithTenantSlot(async () => {
          if (path === '/sets-a') {
            enterTenantContext({ organizationId: 'ORG_A', userId: 'u1' })
            await new Promise((resolve) => setTimeout(resolve, 5))
            expect(getTenantContext()).toMatchObject({ organizationId: 'ORG_A' })
          }
        })
      },
      () => {
        const context = getTenantContext()
        return context && context.kind === 'tenant' ? context.organizationId : null
      },
      ['/sets-a', '/sets-nothing', '/sets-nothing']
    )

    expect(seen.map((entry) => entry.seen)).toEqual([null, null, null])
  })

  it('starts empty, so a handler that sets nothing fails closed', async () => {
    await runWithTenantSlot(async () => {
      expect(getTenantContext()).toBeUndefined()
      expect(() => requireTenantContext()).toThrow(MissingTenantContextError)
    })
  })

  it('leaves no context behind after it returns', async () => {
    await runWithTenantSlot(async () => {
      enterTenantContext({ organizationId: 'ORG_A', userId: 'u1' })
    })
    expect(getTenantContext()).toBeUndefined()
  })
})

describe('enterTenantContext', () => {
  it('fills the slot the request opened', async () => {
    await runWithTenantSlot(async () => {
      enterTenantContext({ organizationId: 'ORG_A', userId: 'u1' })
      expect(getTenantContext()).toEqual({
        kind: 'tenant',
        organizationId: 'ORG_A',
        userId: 'u1',
      })
    })
  })

  it('publishes nothing for a session with no active organization', async () => {
    await runWithTenantSlot(async () => {
      enterTenantContext({ organizationId: null, userId: 'u1' })
      expect(getTenantContext()).toBeUndefined()
    })
  })

  it('CLEARS an existing scope when the session has no organization', async () => {
    await runWithTenantSlot(async () => {
      enterTenantContext({ organizationId: 'ORG_A', userId: 'u1' })
      expect(getTenantContext()).toMatchObject({ organizationId: 'ORG_A' })

      enterTenantContext({ organizationId: null, userId: 'u2' })
      expect(getTenantContext()).toBeUndefined()
      expect(() => requireTenantContext()).toThrow(MissingTenantContextError)
    })
  })

  it('replaces an inherited slot wholesale rather than reusing it', async () => {
    await runWithTenantSlot(async () => {
      enterTenantContext({ organizationId: 'ORG_A', userId: 'u1' })
      enterTenantContext({ organizationId: 'ORG_B', userId: 'u2' })
      expect(getTenantContext()).toMatchObject({ organizationId: 'ORG_B', userId: 'u2' })
    })
  })
})

describe('explicit scopes', () => {
  afterEach(() => {
    expect(getTenantContext()).toBeUndefined()
  })

  it('withTenant scopes to one organization and restores after', async () => {
    const inside = await withTenant({ organizationId: 'ORG_A', userId: 'u1' }, () =>
      getTenantContext()
    )
    expect(inside).toEqual({ kind: 'tenant', organizationId: 'ORG_A', userId: 'u1' })
  })

  it('withTenant awaits a lazy result inside the scope', async () => {
    const lazy = { then: (resolve: (value: unknown) => void) => resolve(getTenantContext()) }
    const observed = await withTenant({ organizationId: 'ORG_A' }, () => lazy)
    expect(observed).toMatchObject({ organizationId: 'ORG_A' })
  })

  it('withPlatformAccess carries its reason', async () => {
    const inside = await withPlatformAccess('nightly sweep', () => getTenantContext())
    expect(inside).toEqual({ kind: 'platform', reason: 'nightly sweep' })
  })

  it('nests: an inner scope wins and the outer one is restored', async () => {
    await withTenant({ organizationId: 'ORG_A' }, async () => {
      await withPlatformAccess('inner', () => {
        expect(getTenantContext()).toMatchObject({ kind: 'platform' })
      })
      expect(getTenantContext()).toMatchObject({ kind: 'tenant', organizationId: 'ORG_A' })
    })
  })

  it('withOptionalTenant picks the tenant when there is one', async () => {
    const inside = await withOptionalTenant('ORG_A', 'unused', () => getTenantContext())
    expect(inside).toMatchObject({ kind: 'tenant', organizationId: 'ORG_A' })
  })

  it('withOptionalTenant falls back to an audited platform scope when there is not', async () => {
    for (const absent of [null, undefined, '']) {
      const inside = await withOptionalTenant(absent, 'org-less telemetry', () =>
        getTenantContext()
      )
      expect(inside).toEqual({ kind: 'platform', reason: 'org-less telemetry' })
    }
  })

  it('restores the previous scope even when the callback throws', async () => {
    await expect(
      withTenant({ organizationId: 'ORG_A' }, () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
  })

  it('keeps concurrent scopes independent', async () => {
    const observe = async (org: string) =>
      withTenant({ organizationId: org }, async () => {
        await new Promise((resolve) => setTimeout(resolve, org === 'ORG_A' ? 20 : 1))
        const context = getTenantContext()
        return context && context.kind === 'tenant' ? context.organizationId : null
      })

    expect(await Promise.all([observe('ORG_A'), observe('ORG_B')])).toEqual(['ORG_A', 'ORG_B'])
  })
})

describe('route factories open a request-scoped slot', () => {
  const FACTORIES: Array<{ file: string; factories: string[] }> = [
    { file: 'bff/api/handler.ts', factories: ['apiRoute', 'internalApiRoute', 'publicApiRoute'] },
    { file: 'bff/api/platform-handler.ts', factories: ['platformApiRoute'] },
    { file: 'bff/agent-api/mcp-door-route.ts', factories: ['mcpDoorPost'] },
  ]

  it.each(FACTORIES)('$file wraps every handler in runWithTenantSlot', ({ file, factories }) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8')

    for (const factory of factories) {
      const start = source.lastIndexOf(`export function ${factory}`)
      expect(start, `${factory} not found in ${file}`).toBeGreaterThan(-1)
      const next = FACTORIES.flatMap((entry) => entry.factories)
        .map((name) => source.indexOf(`export function ${name}`, start + 1))
        .filter((index) => index > start)
      const body = source.slice(start, next.length ? Math.min(...next) : undefined)

      expect(
        body,
        `${factory} must RETURN runWithTenantSlot(...) or tenantSlotRoute(...), or a ` +
          `request can inherit the previous request's tenant off a keep-alive socket.`
      ).toMatch(/return\s+(?:runWithTenantSlot|tenantSlotRoute)\(/)
    }
  })

  it('every API route opens a slot, by factory or explicitly', () => {
    const apiDir = join(process.cwd(), 'app', 'api')
    const routes: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (entry.name === 'route.ts') routes.push(path)
      }
    }
    walk(apiDir)
    expect(routes.length, 'the API route walk found no route.ts files').toBeGreaterThan(0)

    const SCOPED_EXPORT =
      /export\s+const\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=\s*(?:apiRoute|internalApiRoute|publicApiRoute|platformApiRoute|tenantSlotRoute|mcpDoorPost)\s*(?:<[^>]*>)?\s*\(/
    const unscoped = routes
      .filter((path) => !SCOPED_EXPORT.test(readFileSync(path, 'utf8')))
      .map((path) => relative(apiDir, path))

    expect(
      unscoped,
      'These routes open no tenant slot, so they run on the unbounded enterWith ' +
        'fallback and can inherit the previous request\'s tenant. Declare them ' +
        'through a factory, or wrap them in tenantSlotRoute().'
    ).toEqual([])
  })

  it('nothing calls the unbounded enterWith except the documented session fallback', () => {
    const context = readFileSync(join(process.cwd(), 'bff/db/tenant-context.ts'), 'utf8')
    expect(context.match(/storage\.enterWith\(/g) ?? []).toHaveLength(1)
  })
})
