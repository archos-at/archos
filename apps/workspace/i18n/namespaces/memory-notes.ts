import { memoryNotes as en } from '../dictionaries/en/memory-notes'
import { memoryNotes as de } from '../dictionaries/de/memory-notes'
import { defineNamespace } from '../namespace'

export const memoryNotesCopy = defineNamespace('memoryNotes', { en, de })
