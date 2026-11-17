/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'
import { nextConfig } from '../../next.config'

describe('/sw.js headers', () => {
  test('is never cached, is scoped to the origin and is JavaScript', async () => {
    const rules = (await nextConfig.headers?.()) ?? []
    const global = rules.findIndex((rule) => rule.source === '/(.*)')
    const worker = rules.findIndex((rule) => rule.source === '/sw.js')
    expect(worker).toBeGreaterThan(global) // later rules override the global ones
    const headers = Object.fromEntries(rules[worker]!.headers.map((header) => [header.key, header.value]))
    expect(headers['Cache-Control']).toContain('no-cache')
    expect(headers['Cache-Control']).not.toMatch(/max-age=[1-9]/)
    expect(headers['Service-Worker-Allowed']).toBe('/')
    expect(headers['Content-Type']).toMatch(/javascript/)
  })
})
