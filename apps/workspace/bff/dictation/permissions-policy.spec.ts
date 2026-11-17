/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'
import { nextConfig } from '../../next.config'

async function permissionsPolicy(): Promise<string | undefined> {
  const rules = (await nextConfig.headers?.()) ?? []
  const global = rules.find((rule) => rule.source === '/(.*)')
  return global?.headers.find((header) => header.key === 'Permissions-Policy')?.value
}

describe('Permissions-Policy', () => {
  test('lets our own pages use the microphone, and nothing else', async () => {
    const policy = await permissionsPolicy()
    expect(policy).toContain('microphone=(self)')
    expect(policy).toContain('camera=()')
    expect(policy).toContain('geolocation=()')
  })
})
