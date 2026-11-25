'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useChatStore } from '@/features/chat/store'
import { selectThreadPhase, type ThreadPhase } from '../lib/thread-phase'

export interface ChatArrival {
  resumes?: boolean
  greetingName?: string | null
}

const ChatArrivalContext = createContext<ChatArrival>({})

export function ChatArrivalProvider({ value, children }: { value: ChatArrival; children: ReactNode }) {
  return <ChatArrivalContext.Provider value={value}>{children}</ChatArrivalContext.Provider>
}

export function useChatArrival(): ChatArrival {
  return useContext(ChatArrivalContext)
}

export const arrivalPhase = (phase: ThreadPhase, resumes: boolean | undefined): Exclude<ThreadPhase, 'hydrating'> =>
  phase === 'hydrating' ? (resumes === false ? 'empty' : 'loading') : phase

export function useArrivalPredicted(): boolean {
  return useChatStore(selectThreadPhase) === 'hydrating'
}

export function useThreadPhase(): Exclude<ThreadPhase, 'hydrating'> {
  const { resumes } = useChatArrival()
  return arrivalPhase(useChatStore(selectThreadPhase), resumes)
}
