export {
  DictationButton,
  DictationControl,
  DictationStrip,
  LiveDictationStrip,
  createDictationChannel,
  type DictationButtonProps,
  type DictationChannel,
  type DictationSnapshot,
  type DictationControlProps,
  type DictationStripProps,
} from './components/DictationButton'
export type { DictationErrorKey, DictationState } from './hooks/use-dictation'
export {
  insertTranscript,
  type ComposerCaret,
  type InsertedTranscript,
} from './lib/insert-transcript'
