import type { ShareableResourceType } from '@/lib/sharing/types'

export function conversationLink(
  resourceType: ShareableResourceType,
  resourceId: string,
  location: Pick<Location, 'origin' | 'pathname'>,
): string | null {
  if (resourceType !== 'conversation') return null
  if (!/^\/app\/(?:projects\/[^/]+\/)?chat\/?$/.test(location.pathname)) return null
  const url = new URL(location.pathname, location.origin)
  url.searchParams.set('session', resourceId)
  return url.toString()
}

export function canShareNatively(
  nav: Partial<Pick<Navigator, 'share'>> | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): nav is Pick<Navigator, 'share'> {
  return typeof nav?.share === 'function'
}

export type ShareLinkOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'

export async function passOnLink(
  url: string,
  title: string,
  nav: Navigator = navigator,
): Promise<ShareLinkOutcome> {
  if (canShareNatively(nav)) {
    try {
      await nav.share({ title, url })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    }
  }
  try {
    await nav.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}
