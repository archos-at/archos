export type HistoryScope = 'all' | 'chats' | 'research'

export const HISTORY_SCOPES: readonly HistoryScope[] = ['all', 'chats', 'research']

export const isHistoryScope = (value: string): value is HistoryScope =>
  (HISTORY_SCOPES as readonly string[]).includes(value)

export const SCOPE_LABEL_KEY: Record<HistoryScope, string> = {
  all: 'sessionsPanel.filterAll',
  chats: 'sessionsPanel.filterChats',
  research: 'sessionsPanel.filterResearch',
}
