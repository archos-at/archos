/**
 * What Platform → Agents may show platform staff (ADR-0126, ADR-0154).
 *
 * Two MCP servers a platform operator's agent can reach, decided on the server
 * so the page ships addresses and never an environment value:
 *
 *  - the operator console's own door, `/api/platform/mcp`, whenever the
 *    deployment has the external door (`WORKOS_AUTHKIT_DOMAIN`);
 *  - the cluster's own MCP servers behind the platform MCP gateway, one URL
 *    each, from `PLATFORM_MCP_SERVER_URLS`, which the deploy sets only where
 *    the gateway runs.
 */

import { authkitDomain, platformMcpResourceUrl } from '@/lib/agent-api/mcp-config'

/** One in-cluster MCP server behind the gateway. */
export interface McpServerEntry {
  /** Its path segment, `langfuse` for `…/langfuse/mcp`, used as the client's server name. */
  name: string
  url: string
}

export interface PlatformConnectState {
  /** The operator console's MCP URL, or `null` when this deployment has no external door. */
  consoleUrl: string | null
  /** The gateway's servers, empty when it is not deployed here. */
  servers: readonly McpServerEntry[]
}

const SERVER_PATH = /^\/([a-z0-9]+)\/mcp$/

/**
 * `PLATFORM_MCP_SERVER_URLS`: comma-separated `https://<host>/<name>/mcp`. An
 * entry of any other shape is left out rather than shown, since an address
 * that leads nowhere helps nobody.
 */
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
