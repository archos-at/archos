/**
 * @vitest-environment node
 */
/**
 * Which fonts the root layout asks the browser to preload.
 *
 * `next/font` preloads a font on every route unless told not to, and a
 * preloaded file that the first paint does not use is a console warning on
 * every page load ("was preloaded using link preload but not used within a few
 * seconds"). The body face is on every first paint; mono is not.
 */
import { describe, expect, test, vi } from 'vitest'

const fontOptions = vi.hoisted(() => new Map<string, Record<string, unknown>>())

vi.mock('next/font/local', () => ({
  default: (options: Record<string, unknown>) => {
    fontOptions.set(String(options.variable), options)
    return { className: String(options.variable), variable: String(options.variable), style: {} }
  },
}))
vi.mock('./providers', () => ({ Providers: () => null }))
vi.mock('./chunk-reload-guard', () => ({ ChunkReloadGuard: () => null }))
vi.mock('@/components/shell/navigation-trail', () => ({ NavigationTrail: () => null }))
vi.mock('@/lib/auth/session', () => ({ getUserSession: vi.fn() }))
vi.mock('@/lib/db/tenant-context', () => ({ runWithTenantSlot: vi.fn() }))
vi.mock('@/lib/documents/vlm-capability', () => ({ isVlmConfigured: vi.fn() }))
vi.mock('@/i18n/server', () => ({ getLocale: vi.fn() }))

describe('root layout fonts', () => {
  test('preloads the body face and not the mono face', async () => {
    await import('./layout')

    expect(fontOptions.get('--font-body')?.preload).not.toBe(false)
    expect(fontOptions.get('--font-geist-mono')?.preload).toBe(false)
  })
})
