import { memoryTopics as en } from '../dictionaries/en/memory-topics'
import { memoryTopics as de } from '../dictionaries/de/memory-topics'
import { defineNamespace } from '../namespace'

export const memoryTopicsCopy = defineNamespace('memoryTopics', { en, de })
