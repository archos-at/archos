'use client'

import { useEffect } from 'react'
import { useChatStore } from '@/features/chat/store'
import {
  feedbackAnswer,
  feedbackQuestion,
  memoryAnswer,
  memoryCorrectionCards,
  memoryCorrectionDecisions,
} from './answer-fixtures'

export function SeedRetryAction() {
  useEffect(() => {
    useChatStore.setState({
      chatSendFn: () => undefined,
      currentConversation: {
        id: 'conv-feedback-down',
        messages: [
          { id: 'msg-feedback-down-q', role: 'user', messageType: 'user', content: feedbackQuestion },
          { id: 'msg-feedback-down', role: 'assistant', messageType: 'assistant', content: feedbackAnswer },
        ],
      } as never,
    })
  }, [])
  return null
}

export function SeedMemoryDecision() {
  useEffect(() => {
    useChatStore.setState({
      currentConversation: {
        id: 'conv-memory-corrected',
        messages: [
          {
            id: 'msg-memory-corrected',
            role: 'assistant',
            messageType: 'assistant',
            content: memoryAnswer,
            cards: memoryCorrectionCards,
            cardInteractions: memoryCorrectionDecisions,
          },
        ],
      } as never,
    })
  }, [])
  return null
}
