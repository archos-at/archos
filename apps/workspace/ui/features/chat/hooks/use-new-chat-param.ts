import { useEffect, useRef } from 'react'

export function useNewChatParam(newParam: string | null, ready: boolean, startNewChat: () => void): void {
  const consumed = useRef(false)
  useEffect(() => {
    if (!newParam) {
      consumed.current = false
      return
    }
    if (!ready || consumed.current) return
    consumed.current = true
    startNewChat()
  }, [newParam, ready, startNewChat])
}
