/**
 * @vitest-environment node
 */
/**
 * The internal route the platform MCP gateway asks (ADR-0154, amendment of
 * 2026-11-05): its own secret, the roles from the gateway, 2xx only to admit.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/agent-api/platform-admission', () => ({ platformGatewayAdmission: vi.fn() }))

import { platformGatewayAdmission } from '@/lib/agent-api/platform-admission'
import { DELETE, GET, POST } from './route'

const SECRET = 'admission-token-for-tests' // pragma: allowlist secret
const URL_WITH_ROLE = 'http://frontend:3000/api/internal/platform-mcp-admission?role=org-platform-owner'

const call = (handler: typeof POST, headers: Record<string, string>, url = URL_WITH_ROLE) =>
  handler(new Request(url, { method: 'POST', headers }))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PLATFORM_MCP_ADMISSION_TOKEN = SECRET
  process.env.INTERNAL_API_TOKEN = 'the-shared-service-token' // pragma: allowlist secret
  vi.mocked(platformGatewayAdmission).mockResolvedValue({ admitted: true, userId: 'user_ops' })
})

describe('platform-mcp-admission', () => {
  it('admits with 200 for every method an MCP session uses, passing the bearer and the roles through', async () => {
    for (const handler of [GET, POST, DELETE]) {
      const response = await call(handler, { 'x-internal-token': SECRET, authorization: 'Bearer t' })
      expect(response.status).toBe(200)
    }
    expect(platformGatewayAdmission).toHaveBeenCalledWith('Bearer t', ['org-platform-owner'])
  })

  it('takes its own secret only: the shared service token and no token are refused', async () => {
    expect((await call(POST, { 'x-internal-token': 'the-shared-service-token' })).status).toBe(403)
    expect((await call(POST, {})).status).toBe(403)
    expect(platformGatewayAdmission).not.toHaveBeenCalled()
  })

  it('is shut, 503, while the secret is not configured', async () => {
    delete process.env.PLATFORM_MCP_ADMISSION_TOKEN
    expect((await call(POST, { 'x-internal-token': SECRET })).status).toBe(503)
  })

  it('refuses a call that names no role rather than admitting on none', async () => {
    const response = await call(POST, { 'x-internal-token': SECRET }, 'http://frontend:3000/api/internal/platform-mcp-admission')
    expect(response.status).toBe(400)
    expect(platformGatewayAdmission).not.toHaveBeenCalled()
  })

  it('answers the refusal’s status, never a 2xx, when the person is not admitted', async () => {
    for (const status of [401, 403, 503] as const) {
      vi.mocked(platformGatewayAdmission).mockResolvedValue({ admitted: false, status, reason: 'no' })
      expect((await call(POST, { 'x-internal-token': SECRET })).status).toBe(status)
    }
  })
})
