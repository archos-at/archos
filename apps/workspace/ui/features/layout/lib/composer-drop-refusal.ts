export type ComposerDropRefusal =
  | 'dropRefusedReadOnly'
  | 'dropRefusedAnswering'
  | 'dropRefusedQuestion'
  | 'dropRefusedUploading'
  | 'uploadNotAvailable'

export interface ComposerDropFacts {
  canContribute: boolean
  isStreaming: boolean
  awaitsAnswer: boolean
  isUploading: boolean
  knowledgeLayerAvailable: boolean
}

export function composerDropRefusal(facts: ComposerDropFacts): ComposerDropRefusal | null {
  if (!facts.canContribute) return 'dropRefusedReadOnly'
  if (facts.awaitsAnswer) return 'dropRefusedQuestion'
  if (facts.isStreaming) return 'dropRefusedAnswering'
  if (facts.isUploading) return 'dropRefusedUploading'
  if (!facts.knowledgeLayerAvailable) return 'uploadNotAvailable'
  return null
}
