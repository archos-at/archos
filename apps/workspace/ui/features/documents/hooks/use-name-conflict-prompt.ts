'use client'

import { createContext, useCallback, useRef, useState } from 'react'
import type { ConflictChoice, ConflictOperation, ConflictRow } from '../lib/name-conflict'

export interface ConflictQuestion {
  operation: ConflictOperation
  folderName: string
  rows: readonly ConflictRow[]
}

export type ConflictAnswer = ReadonlyMap<string, ConflictChoice>

interface Asked extends ConflictQuestion {
  answer: (choices: ConflictAnswer | null) => void
}

export type AskNameConflicts = (question: ConflictQuestion) => Promise<ConflictAnswer | null>

export const NameConflictAskContext = createContext<AskNameConflicts | null>(null)

export interface NameConflictPrompt {
  ask: AskNameConflicts
  question: ConflictQuestion | null
  resolve: (choices: ConflictAnswer | null) => void
}

export function useNameConflictPrompt(): NameConflictPrompt {
  const [question, setQuestion] = useState<Asked | null>(null)
  const waiting = useRef<Asked[]>([])
  const showing = useRef<Asked | null>(null)

  const show = useCallback((next: Asked | null) => {
    showing.current = next
    setQuestion(next)
  }, [])

  const ask = useCallback(
    (asked: ConflictQuestion) =>
      new Promise<ConflictAnswer | null>((answer) => {
        if (asked.rows.length === 0) {
          answer(new Map())
          return
        }
        const entry = { ...asked, answer }
        if (showing.current) waiting.current.push(entry)
        else show(entry)
      }),
    [show]
  )

  const resolve = useCallback(
    (choices: ConflictAnswer | null) => {
      const current = showing.current
      if (!current) return
      show(waiting.current.shift() ?? null)
      current.answer(choices)
    },
    [show]
  )

  return { ask, question, resolve }
}
