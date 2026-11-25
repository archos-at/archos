import type { CacheHint, McpServerOptions } from '@modelcontextprotocol/server'

const MINUTE_MS = 60_000

export const DEPLOY_TEXT: CacheHint = { ttlMs: 60 * MINUTE_MS, cacheScope: 'private' }

export const PERSON_SURFACE: CacheHint = { ttlMs: 10 * MINUTE_MS, cacheScope: 'private' }

export const DOOR_CACHE_HINTS: NonNullable<McpServerOptions['cacheHints']> = {
  'server/discover': PERSON_SURFACE,
  'tools/list': PERSON_SURFACE,
  'prompts/list': PERSON_SURFACE,
  'resources/templates/list': PERSON_SURFACE,
  'resources/list': { ttlMs: MINUTE_MS, cacheScope: 'private' },
}
