import { lawMap as en } from '../dictionaries/en/law-map'
import { lawMap as de } from '../dictionaries/de/law-map'
import { defineNamespace } from '../namespace'

export const lawMapCopy = defineNamespace('lawMap', { en, de })
