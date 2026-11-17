'use client'

import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  findSlashCommandQuery,
  insertSlashCommand,
  resolveSlashInvocation,
  type SlashCommandQuery,
} from '../lib/slash-command'
import type {
  SlashCommandPickerHandle,
  SlashCommandPickerAria,
  SlashCommandSkill,
} from '../components/SlashCommandPicker'
import { useInvocableSkills } from './use-invocable-skills'

export interface UseSlashCommandOptions {
  text: string
  enabled: boolean
  onReplaceText: (text: string, caret: number) => void
}

export interface UseSlashCommandResult {
  open: boolean
  query: string
  skills: SlashCommandSkill[]
  loading: boolean
  pickerRef: React.RefObject<SlashCommandPickerHandle | null>
  aria: SlashCommandPickerAria
  onAriaChange: (aria: SlashCommandPickerAria) => void
  syncQuery: (text: string, caret: number) => void
  select: (skill: SlashCommandSkill) => void
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>, onSubmit: () => void) => boolean
  invokedSkill: SlashCommandSkill | null
  clearInvocation: () => void
  dismiss: () => void
}

export function useSlashCommand({
  text,
  enabled,
  onReplaceText,
}: UseSlashCommandOptions): UseSlashCommandResult {
  const [query, setQuery] = useState<SlashCommandQuery | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [aria, setAria] = useState<SlashCommandPickerAria>({
    listboxId: null,
    activeOptionId: null,
  })
  const pickerRef = useRef<SlashCommandPickerHandle>(null)

  const namesSomething = /^\s*\/[^\s/]+/.test(text)
  const { skills, loading, available } = useInvocableSkills(enabled && (query !== null || namesSomething))

  const names = useMemo(() => skills.map((skill) => skill.name), [skills])

  const invokedSkill = useMemo(() => {
    if (!enabled) return null
    const invocation = resolveSlashInvocation(text, names)
    if (!invocation) return null
    return skills.find((skill) => skill.name === invocation.skillName) ?? null
  }, [enabled, names, skills, text])

  const syncQuery = useCallback(
    (nextText: string, caret: number) => {
      if (!enabled) return
      const range = findSlashCommandQuery(nextText, caret)
      setQuery(range)
      if (range === null) setDismissed(false)
    },
    [enabled],
  )

  const select = useCallback(
    (skill: SlashCommandSkill) => {
      if (!query) return
      const { text: nextText, caret } = insertSlashCommand(text, query, skill.name)
      onReplaceText(nextText, caret)
      setQuery(null)
      setDismissed(false)
    },
    [onReplaceText, query, text],
  )

  const open = enabled && query !== null && !dismissed && (loading || available)

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>, onSubmit: () => void): boolean => {
      if (!open) return false

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        pickerRef.current?.move(1)
        return true
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        pickerRef.current?.move(-1)
        return true
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        if (pickerRef.current?.selectActive()) return true
        setDismissed(true)
        if (event.key === 'Enter') onSubmit()
        return true
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setDismissed(true)
        return true
      }
      return false
    },
    [open],
  )

  const dismiss = useCallback(() => setDismissed(true), [])

  const clearInvocation = useCallback(() => {
    const invocation = resolveSlashInvocation(text, names)
    if (!invocation) return
    const start = text.search(/\S/)
    const rest = text.slice(start + 1 + invocation.token.length).replace(/^[ \t]/, '')
    const next = `${text.slice(0, start)}${rest}`
    onReplaceText(next, start)
  }, [names, onReplaceText, text])

  return {
    open,
    query: query?.query ?? '',
    skills,
    loading,
    pickerRef,
    aria,
    onAriaChange: setAria,
    syncQuery,
    select,
    handleKeyDown,
    invokedSkill,
    clearInvocation,
    dismiss,
  }
}
