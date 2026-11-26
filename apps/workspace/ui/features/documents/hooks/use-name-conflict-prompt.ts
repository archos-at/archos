'use client'

import { createContext, useCallback, useRef, useState } from 'react'
import type { ConflictChoice, ConflictOperation, ConflictRow } from '../lib/name-conflict'

export interface ConflictQuestion {
  operation: ConflictOperation
  folderName: string
  rows: readonly ConflictRow[]
}

export type ConflictAnswer = ReadonlyMap<string, ConflictChoice>

export interface AskedQuestion extends ConflictQuestion {
  id: number
}

interface Asked extends AskedQuestion {
  answer: (choices: ConflictAnswer | null) => void
}

export type AskNameConflicts = (question: ConflictQuestion) => Promise<ConflictAnswer | null>

export const NameConflictAskContext = createContext<AskNameConflicts | null>(null)

export interface NameConflictPrompt {
  ask: AskNameConflicts
  question: AskedQuestion | null
  resolve: (choices: ConflictAnswer | null) => void
}

export function useNameConflictPrompt(): NameConflictPrompt {
  const [question, setQuestion] = useState<Asked | null>(null)
  const waiting = useRef<Asked[]>([])
  const showing = useRef<Asked | null>(null)
  const asked = useRef(0)

  const show = useCallback((next: Asked | null) => {
    showing.current = next
    setQuestion(next)
  }, [])

  const ask = useCallback(
    (question: ConflictQuestion) =>
      new Promise<ConflictAnswer | null>((answer) => {
        if (question.rows.length === 0) {
          answer(new Map())
          return
        }
        const entry = { ...question, id: (asked.current += 1), answer }
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
