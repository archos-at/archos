import { baseKnowledge as en } from '../dictionaries/en/base-knowledge'
import { baseKnowledge as de } from '../dictionaries/de/base-knowledge'
import { defineNamespace } from '../namespace'

export const baseKnowledgeCopy = defineNamespace('baseKnowledge', { en, de })
