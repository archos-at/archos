/**
 * FALLBACK, delete after rollover: the style a line is written in while no
 * country's `citation_style` ruleset is released (rollover-to-prod.md). It is the
 * payload of the first country's record, the form every line had before, held
 * equal to it by `citation-lines.fixture.spec.ts`. Its own module, so the record's
 * wire stays a leaf and this file goes whole.
 */

import { citationStyleSchema, type CitationStylePayload } from '@/lib/base-knowledge/wire/citation-style'
import fallbackStyles from './citation-style.fallback.json'

export const FALLBACK_CITATION_STYLES: CitationStylePayload = citationStyleSchema.parse({ styles: fallbackStyles.styles })
