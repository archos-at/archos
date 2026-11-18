import { useCallback, useEffect, useState } from 'react'
import { loadUploadScreeningPolicy } from '@/adapters/api/upload-screening-policy'
import {
  chatScreeningRules,
  maskText,
  type ContentScreenRules,
  type MaskedText,
} from '@/lib/upload-screening/content-screen'
import { SUGGESTED_SCREENING_POLICY } from '@/lib/upload-screening/policy'

export function useChatScreening(): (text: string) => MaskedText {
  const [rules, setRules] = useState<ContentScreenRules | null>(() =>
    chatScreeningRules(SUGGESTED_SCREENING_POLICY)
  )

  useEffect(() => {
    let live = true
    loadUploadScreeningPolicy().then(
      (policy) => {
        if (live) setRules(chatScreeningRules(policy))
      },
      () => {
        // A failed read keeps the agent's suggested list: a privacy control fails closed.
      }
    )
    return () => {
      live = false
    }
  }, [])

  return useCallback((text: string) => maskText(text, rules), [rules])
}
