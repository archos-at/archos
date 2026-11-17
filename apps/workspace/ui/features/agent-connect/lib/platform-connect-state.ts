import { authkitDomain, platformMcpResourceUrl } from '@/lib/agent-api/mcp-config'

export interface McpServerEntry {
  name: string
  url: string
}

export interface PlatformConnectState {
  consoleUrl: string | null
  servers: readonly McpServerEntry[]
}

const SERVER_PATH = /^\/([a-z0-9]+)\/mcp$/

export function parseServerUrls(raw: string | undefined): McpServerEntry[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .flatMap((entry): McpServerEntry[] => {
      if (!URL.canParse(entry)) return []
      const url = new URL(entry)
      const name = SERVER_PATH.exec(url.pathname)?.[1]
      return url.protocol === 'https:' && name ? [{ name, url: url.toString() }] : []
    })
}

type Env = Record<string, string | undefined>

export function loadPlatformConnectState(env: Env = process.env): PlatformConnectState {
  return {
    consoleUrl: authkitDomain(env) ? (platformMcpResourceUrl(env)?.toString() ?? null) : null,
    servers: parseServerUrls(env.PLATFORM_MCP_SERVER_URLS),
  }
}
