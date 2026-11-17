import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from 'react'
import { useChatStore } from '@/features/chat/store'
import type { MentionPickerHandle } from '@/features/collaboration/components/MentionPicker'
import type { useDocumentReference } from '@/features/search'
import type { useSlashCommand } from '@/features/skills/hooks/use-slash-command'
import type { useComposerSubmit } from './use-composer-submit'

interface ComposerKeyboardInput {
  slash: ReturnType<typeof useSlashCommand>
  reference: ReturnType<typeof useDocumentReference>
  handleSubmit: ReturnType<typeof useComposerSubmit>['handleSubmit']
  mentionPickerOpen: boolean
  mentionPickerRef: RefObject<MentionPickerHandle | null>
  setMentionDismissed: (value: boolean) => void
  textareaRef: RefObject<HTMLTextAreaElement | null>
  composerRootRef: RefObject<HTMLDivElement | null>
  showStop: boolean
  cannotContribute: boolean
}

export function useComposerKeyboard({
  slash,
  reference,
  handleSubmit,
  mentionPickerOpen,
  mentionPickerRef,
  setMentionDismissed,
  textareaRef,
  composerRootRef,
  showStop,
  cannotContribute,
}: ComposerKeyboardInput) {
  const stopStreaming = useChatStore((s) => s.stopStreaming)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return

      if (slash.handleKeyDown(e, handleSubmit)) return
      if (reference.handleKeyDown(e, handleSubmit)) return

      if (mentionPickerOpen) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          mentionPickerRef.current?.move(1)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          mentionPickerRef.current?.move(-1)
          return
        }
        if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
          e.preventDefault()
          if (mentionPickerRef.current?.selectActive()) return
          setMentionDismissed(true)
          if (e.key === 'Enter') handleSubmit()
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          setMentionDismissed(true)
          textareaRef.current?.focus()
          return
        }
      }

      if (e.key !== 'Enter') return
      if (e.shiftKey) return
      if (e.repeat) {
        e.preventDefault()
        return
      }
      e.preventDefault()
      handleSubmit()
    },
    [handleSubmit, mentionPickerOpen, slash, reference]
  )

  const composerHadFocusRef = useRef(false)
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      composerHadFocusRef.current =
        e.target instanceof Node && (composerRootRef.current?.contains(e.target) ?? false)
    }
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Node && composerRootRef.current?.contains(e.target)) return
      composerHadFocusRef.current = false
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('click', onClick, true)
    }
  }, [])

  useEffect(() => {
    if (!showStop || cannotContribute) return
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.keyCode === 229) return
      const target = e.target
      const fromComposer =
        (target === document.body && composerHadFocusRef.current) ||
        (target instanceof Node && (composerRootRef.current?.contains(target) ?? false))
      if (!fromComposer) return
      e.preventDefault()
      stopStreaming?.()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [showStop, cannotContribute, stopStreaming])

  return { handleKeyDown }
}
