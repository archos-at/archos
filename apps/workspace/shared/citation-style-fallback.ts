import { citationStyleSchema, type CitationStylePayload } from '@/lib/base-knowledge/wire/citation-style'
import fallbackStyles from './citation-style.fallback.json'

export const FALLBACK_CITATION_STYLES: CitationStylePayload = citationStyleSchema.parse({ styles: fallbackStyles.styles })
