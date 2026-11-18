/**
 * @vitest-environment node
 */

import { hasLocalMatch } from 'next/dist/shared/lib/match-local-pattern'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { nextConfig } from '../../next.config'
import { buildDocumentImageUrl } from './signed-image-url'
import { isOptimizerEligible, LOCAL_IMAGE_PATTERNS } from './optimizable'

const configuredPatterns = nextConfig.images?.localPatterns

beforeAll(() => {
  vi.stubEnv('INTERNAL_API_TOKEN', 'test-secret-for-local-pattern-check')
})

describe('images.localPatterns admits the URLs we actually render', () => {
  it('is configured at all — an absent allow-list is not the same as an open one', () => {
    expect(configuredPatterns).toEqual(LOCAL_IMAGE_PATTERNS.map((pattern) => ({ ...pattern })))
  })

  it.each(['original', 'thumb'] as const)('accepts a signed %s document image', (variant) => {
    const url = buildDocumentImageUrl('org_123', 'user_789', 'doc_456', variant)
    expect(url).not.toBeNull()
    expect(url).toContain('?')
    expect(hasLocalMatch(configuredPatterns, url!)).toBe(true)
  })

  it('still accepts ordinary local images, which the default allowed', () => {
    expect(hasLocalMatch(configuredPatterns, '/logo.svg')).toBe(true)
    expect(hasLocalMatch(configuredPatterns, '/_next/static/media/hero.a1b2c3.png')).toBe(true)
  })

  it('does not open the optimizer to arbitrary query strings', () => {
    expect(hasLocalMatch(configuredPatterns, '/api/projects/list?page=2')).toBe(false)
    expect(hasLocalMatch(configuredPatterns, '/logo.svg?v=2')).toBe(false)
    expect(hasLocalMatch(configuredPatterns, '/api/documents/doc_1/download?x=1')).toBe(false)
    expect(hasLocalMatch(configuredPatterns, '/api/documents/a/b/image?x=1')).toBe(false)
  })
})

describe('isOptimizerEligible agrees with the optimizer', () => {
  const localCases = [
    '/logo.svg',
    '/logo.svg?v=2',
    '/_next/static/media/hero.a1b2c3.png',
    '/api/documents/doc_1/image?org=o&v=thumb&exp=1&sig=deadbeef',
    '/api/documents/doc_1/image',
    '/api/documents/doc_1/download?x=1',
    '/api/documents/a/b/image?x=1',
    '/api/projects/list?page=2',
  ]

  it.each(localCases)('reaches the same verdict as hasLocalMatch for %s', (src) => {
    expect(isOptimizerEligible(src)).toBe(hasLocalMatch(configuredPatterns, src))
  })

  it('rejects what is not a local path at all, which hasLocalMatch never sees', () => {
    expect(isOptimizerEligible('https://storage.internal/bucket/doc.png?sig=x')).toBe(false)
    expect(isOptimizerEligible('//storage.internal/bucket/doc.png')).toBe(false)
    expect(isOptimizerEligible(null)).toBe(false)
    expect(isOptimizerEligible('')).toBe(false)
  })
})
