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
