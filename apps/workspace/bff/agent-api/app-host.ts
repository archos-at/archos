import { RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server'
import { audienceOf, doorOfPrincipal } from './exposure'
import type { McpCallContext } from './telemetry'

export const UI_EXTENSION = 'io.modelcontextprotocol/ui'

export function declaresMcpApps(capabilities: unknown): boolean {
  const extensions = isRecord(capabilities) ? capabilities.extensions : undefined
  const ui = isRecord(extensions) ? extensions[UI_EXTENSION] : undefined
  const mimeTypes = isRecord(ui) ? ui.mimeTypes : undefined
  return Array.isArray(mimeTypes) && mimeTypes.includes(RESOURCE_MIME_TYPE)
}

export function appHostOf(era: 'modern' | 'legacy', clientCapabilities: unknown): McpCallContext['appHost'] {
  if (era === 'legacy') return 'unknown'
  return declaresMcpApps(clientCapabilities) ? 'declared' : undefined
}

export function offersAppViews(ctx: Pick<McpCallContext, 'principal' | 'appHost'>): boolean {
  return ctx.appHost !== undefined && doorOfPrincipal(ctx.principal) === 'office' && audienceOf(ctx.principal) === 'external'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
