import { withLegacyHeaderNames } from '@/lib/http/legacy-header-names'

export const HEADLESS_MODE_HEADERS = withLegacyHeaderNames({ 'x-chat-mode': 'headless' })
