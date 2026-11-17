import type { DraftMention } from '@/lib/mentions/mention-text'
import type { ComposerPrefill, ComposerSubject } from '../types'
import type { MessagesGet, MessagesSet, MessagesSlice } from './messages-slice-types'

export const createComposerActions = (
  set: MessagesSet,
  get: MessagesGet
): Pick<
  MessagesSlice,
  | 'setComposerPrefill'
  | 'setComposerSubject'
  | 'consumeComposerPrefill'
  | 'setChatSendFn'
  | 'setComposerDraft'
  | 'getComposerDraft'
  | 'clearComposerDraft'
> => {
  return {
    setComposerPrefill: (text: string, mentions?: DraftMention[], subject?: ComposerSubject) => {
      const prefill: ComposerPrefill =
        mentions && mentions.length > 0 ? { text, mentions, subject } : { text, subject }
      set(
        {
          composerPrefill: prefill,
          ...(subject !== undefined ? { composerSubject: subject ?? null } : {}),
        },
        false,
        'setComposerPrefill'
      )
    },

    setComposerSubject: (subject: ComposerSubject | null) => {
      set({ composerSubject: subject }, false, 'setComposerSubject')
    },

    consumeComposerPrefill: () => {
      const { composerPrefill } = get()
      if (composerPrefill === null) return null
      set({ composerPrefill: null }, false, 'consumeComposerPrefill')
      return composerPrefill
    },

    setChatSendFn: (fn) => {
      set({ chatSendFn: fn }, false, 'setChatSendFn')
    },

    setComposerDraft: (conversationId: string, text: string) => {
      const { composerDrafts } = get()
      const current = composerDrafts[conversationId]

      if (text === '') {
        if (current === undefined) return
        const next = { ...composerDrafts }
        delete next[conversationId]
        set({ composerDrafts: next }, false, 'setComposerDraft:clear')
        return
      }

      if (current === text) return
      set(
        { composerDrafts: { ...composerDrafts, [conversationId]: text } },
        false,
        'setComposerDraft'
      )
    },

    getComposerDraft: (conversationId: string) => {
      return get().composerDrafts[conversationId] ?? ''
    },

    clearComposerDraft: (conversationId: string) => {
      const { composerDrafts } = get()
      if (!(conversationId in composerDrafts)) return
      const next = { ...composerDrafts }
      delete next[conversationId]
      set({ composerDrafts: next }, false, 'clearComposerDraft')
    },
  }
}
