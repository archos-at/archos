import { describe, expect, test } from 'vitest'
import { loadPlatformConnectState, parseServerUrls } from './platform-connect-state'

describe('parseServerUrls', () => {
  test('names each server after its path segment', () => {
    expect(
      parseServerUrls('https://platform-mcp.example.test/langfuse/mcp, https://platform-mcp.example.test/tools2/mcp'),
    ).toEqual([
      { name: 'langfuse', url: 'https://platform-mcp.example.test/langfuse/mcp' },
      { name: 'tools2', url: 'https://platform-mcp.example.test/tools2/mcp' },
    ])
  })

  test('leaves out what would lead nowhere: plain http, another path, not a URL', () => {
    expect(
      parseServerUrls('http://platform-mcp.example.test/langfuse/mcp,https://x.test/langfuse,nonsense,,https://x.test/a_b/mcp'),
    ).toEqual([])
  })

  test('unset is no servers', () => {
    expect(parseServerUrls(undefined)).toEqual([])
  })
})

describe('loadPlatformConnectState', () => {
  test('offers the console door only where the external sign-in is configured', () => {
    const env = { MCP_RESOURCE_URL: 'https://app.example.test/api/mcp' }
    expect(loadPlatformConnectState(env).consoleUrl).toBeNull()
    expect(loadPlatformConnectState({ ...env, WORKOS_AUTHKIT_DOMAIN: 'tenant.authkit.app' }).consoleUrl).toBe(
      'https://app.example.test/api/platform/mcp',
    )
  })

  test('reads the gateway servers the deploy set', () => {
    const state = loadPlatformConnectState({ PLATFORM_MCP_SERVER_URLS: 'https://platform-mcp.example.test/langfuse/mcp' })
    expect(state.servers).toEqual([{ name: 'langfuse', url: 'https://platform-mcp.example.test/langfuse/mcp' }])
  })
})
