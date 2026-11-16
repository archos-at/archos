/**
 * @vitest-environment node
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { ImageOptimizerCache } from 'next/dist/server/image-optimizer'
import { getMaxAge } from 'next/dist/server/image-optimizer/get-max-age'
import { imageConfigDefault } from 'next/dist/shared/lib/image-config'
import { afterEach, describe, expect, it } from 'vitest'

import { nextConfig } from '../../next.config'
import { DOCUMENT_IMAGE_CACHE_CONTROL, IMAGE_URL_WINDOW_SECONDS } from './signed-image-url'

type CacheOptions = ConstructorParameters<typeof ImageOptimizerCache>[0]

const distDirs: string[] = []

afterEach(() => {
  for (const dir of distDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function optimizerCache(images: Partial<typeof imageConfigDefault>): ImageOptimizerCache {
  const distDir = mkdtempSync(path.join(tmpdir(), 'image-cache-'))
  distDirs.push(distDir)
  const config = {
    images: { ...imageConfigDefault, ...images },
    experimental: { isrFlushToDisk: true },
  } as unknown as CacheOptions['nextConfig']
  return new ImageOptimizerCache({ distDir, nextConfig: config })
}

async function storeAndRead(cache: ImageOptimizerCache) {
  const key = ImageOptimizerCache.getCacheKey({
    href: '/api/documents/doc-1/image?org=o&u=u&v=original&exp=1&sig=s',
    width: 640,
    quality: 75,
    mimeType: 'image/webp',
  })
  await cache.set(
    key,
    {
      kind: 'IMAGE',
      etag: 'etag',
      upstreamEtag: 'upstream-etag',
      buffer: Buffer.from('optimized bytes'),
      extension: 'webp',
    } as Parameters<ImageOptimizerCache['set']>[1],
    { cacheControl: { revalidate: IMAGE_URL_WINDOW_SECONDS, expire: undefined } },
  )
  return cache.get(key)
}

describe('the image optimizer keeps no copy of a document image', () => {
  it('can tell a caching optimizer from one that is off (the default caches)', async () => {
    const entry = await storeAndRead(optimizerCache({ maximumDiskCacheSize: 10_000_000 }))
    expect(entry?.value).toMatchObject({ kind: 'IMAGE' })
  })

  it('serves nothing from cache under our config, so every request reaches the access check', async () => {
    const entry = await storeAndRead(optimizerCache({ ...nextConfig.images }))
    expect(entry).toBeNull()
  })

  it('lets no browser or shared cache keep the optimized image longer than one token window', () => {
    const minimumCacheTTL = nextConfig.images?.minimumCacheTTL ?? imageConfigDefault.minimumCacheTTL
    const sent = Math.max(minimumCacheTTL, getMaxAge(DOCUMENT_IMAGE_CACHE_CONTROL))
    expect(sent).toBeLessThanOrEqual(IMAGE_URL_WINDOW_SECONDS)
  })
})
