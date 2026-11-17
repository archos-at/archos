'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type ReactNode,
} from 'react'
import { referencesByNumber, type CitedDocument, type CitationRef } from '../lib/citations'

interface CitationScopeValue {
  documents: CitedDocument[]
  anchorPrefix: string
  referenceFor: (number: number) => CitationRef | undefined
  focused: number | null
  focus: (number: number) => void
}

const CitationScopeContext = createContext<CitationScopeValue | null>(null)

const FOCUS_MS = 2200

export const CitationScope: FC<{
  documents: CitedDocument[]
  anchorPrefix: string
  children: ReactNode
}> = ({ documents, anchorPrefix, children }) => {
  const [focused, setFocused] = useState<number | null>(null)
  const timer = useRef<number | null>(null)

  const focus = useCallback((number: number) => {
    setFocused(number)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setFocused(null), FOCUS_MS)
  }, [])

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )

  const value = useMemo<CitationScopeValue>(() => {
    const byNumber = referencesByNumber(documents)
    return {
      documents,
      anchorPrefix,
      referenceFor: (number: number) => byNumber.get(number),
      focused,
      focus,
    }
  }, [documents, anchorPrefix, focused, focus])

  return <CitationScopeContext.Provider value={value}>{children}</CitationScopeContext.Provider>
}

export const useCitationScope = (): CitationScopeValue | null => useContext(CitationScopeContext)
