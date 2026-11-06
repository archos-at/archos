import type { AgentConnectState } from '../lib/connect-state'
import type { PlatformConnectState } from '../lib/platform-connect-state'

/** One fixture per state the section can be in, for the specs and `/dev/connect-agent`. */
export const CONNECT_AGENT_FIXTURES = {
  ready: { availability: 'ready', url: 'https://app.piloti.at/api/mcp', canAdminister: false },
  orgDisabledMember: { availability: 'org-disabled', url: null, canAdminister: false },
  orgDisabledAdmin: { availability: 'org-disabled', url: null, canAdminister: true },
  notConfigured: { availability: 'not-configured', url: null, canAdminister: false },
  notConfiguredAdmin: { availability: 'not-configured', url: null, canAdminister: true },
} as const satisfies Record<string, AgentConnectState>

/** Platform → Agents, one fixture per state, for the specs and `/dev/platform-agents`. */
export const PLATFORM_CONNECT_FIXTURES = {
  both: {
    consoleUrl: 'https://app.example.test/api/platform/mcp',
    servers: [{ name: 'langfuse', url: 'https://platform-mcp.example.test/langfuse/mcp' }],
  },
  consoleOnly: { consoleUrl: 'https://app.example.test/api/platform/mcp', servers: [] },
  neither: { consoleUrl: null, servers: [] },
} as const satisfies Record<string, PlatformConnectState>
