import type { MaskedText } from '@/lib/upload-screening/content-screen'

export interface ScreeningHold {
  original: string
  masked: MaskedText
  heldText?: string
}

export interface ComposerNote {
  text: string
  tone: 'error' | 'info'
}

export type SetComposerNote = (note: ComposerNote | null) => void
