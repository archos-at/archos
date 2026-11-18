import { withProductName } from '@/lib/brand'
import { en as enSource } from './en'
import { de as deSource } from './de'
import type { Locale } from '../config'

const en = withProductName(enSource)
const de = withProductName(deSource)

export type Dictionary = typeof en

export const dictionaries: Record<Locale, Dictionary> = { en, de }

export { en, de }
