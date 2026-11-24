export function configuredAppOrigin(
  env: Record<string, string | undefined> = process.env
): string | null {
  const configured = env.WORKOS_REDIRECT_URI || env.NEXT_PUBLIC_WORKOS_REDIRECT_URI
  if (!configured) return null
  try {
    return new URL(configured).origin
  } catch {
    return null
  }
}

/** The host this deployment serves the app on (`app.archos.tech`): the redirect URI's, else the MCP resource URL's. */
export function configuredAppHost(env: Record<string, string | undefined> = process.env): string | null {
  const origin = configuredAppOrigin(env) ?? configuredAppOrigin({ WORKOS_REDIRECT_URI: env.MCP_RESOURCE_URL })
  return origin ? new URL(origin).host : null
}
