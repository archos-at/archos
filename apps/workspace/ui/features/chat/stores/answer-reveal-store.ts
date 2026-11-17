import { create } from 'zustand'

interface AnswerRevealState {
  revealingId: string | null
  begin: (messageId: string) => void
  end: (messageId: string) => void
}

export const useAnswerRevealStore = create<AnswerRevealState>()((set) => ({
  revealingId: null,
  begin: (messageId) => set({ revealingId: messageId }),
  end: (messageId) => set((s) => (s.revealingId === messageId ? { revealingId: null } : s)),
}))

const shownTexts = new Map<string, () => string>()

export const registerShownText = (messageId: string, read: () => string): (() => void) => {
  shownTexts.set(messageId, read)
  return () => {
    if (shownTexts.get(messageId) === read) shownTexts.delete(messageId)
  }
}

export const shownTextOf = (messageId: string): string | undefined => shownTexts.get(messageId)?.()
