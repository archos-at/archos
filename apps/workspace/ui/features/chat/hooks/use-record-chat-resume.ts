'use client'

import { useEffect } from 'react'
import { useChatStore, type ChatStoreWithHydration } from '@/features/chat/store'
import { resumeCookieNames, resumeCookieWrites, resumeDeadlines } from '@/features/chat/lib/resume-cookie'

const SETTLE_MS = 1000

export function useRecordChatResume(): void {
  useEffect(() => {
    const written = new Map<string, number>(resumeCookieNames(document.cookie).map((name) => [name, Number.NaN]))
    let timer: ReturnType<typeof setTimeout> | undefined
    const record = (): void => {
      timer = undefined
      const state = useChatStore.getState()
      if (!state.hasHydrated || !state.currentUserId) return
      const now = Date.now()
      const wanted = resumeDeadlines(state, now)
      for (const write of resumeCookieWrites(written, wanted, now)) document.cookie = write
      written.clear()
      for (const [name, until] of wanted) written.set(name, until)
    }
    const schedule = (state: ChatStoreWithHydration, previous: ChatStoreWithHydration): void => {
      if (
        timer !== undefined ||
        (state.conversations === previous.conversations &&
          state.currentConversation === previous.currentConversation &&
          state.currentUserId === previous.currentUserId &&
          state.hasHydrated === previous.hasHydrated)
      ) {
        return
      }
      timer = setTimeout(record, SETTLE_MS)
    }
    const flush = (): void => {
      if (timer === undefined) return
      clearTimeout(timer)
      record()
    }
    record()
    const unsubscribe = useChatStore.subscribe(schedule)
    window.addEventListener('pagehide', flush)
    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])
}
