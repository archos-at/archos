import { projectIdFromPathname } from './org-sections'

export const PERSONAL_CHAT_PATH = '/app/personal/chat'
export const PERSONAL_SHELF_PATH = '/app/personal-shelf'

export type RailMode = 'personal' | 'project'

const under = (pathname: string, base: string): boolean => pathname === base || pathname.startsWith(`${base}/`)

export function railModeOf(pathname: string): RailMode | null {
  const path = pathname.split('?')[0]
  if (under(path, '/app/personal') || under(path, PERSONAL_SHELF_PATH)) return 'personal'
  return projectIdFromPathname(path) ? 'project' : null
}

export function personalChatHref(conversationId?: string): string {
  return conversationId ? `${PERSONAL_CHAT_PATH}?session=${encodeURIComponent(conversationId)}` : PERSONAL_CHAT_PATH
}

export const NEW_PERSONAL_CHAT_HREF = `${PERSONAL_CHAT_PATH}?new=1`
