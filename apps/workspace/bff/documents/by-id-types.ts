import { z } from 'zod'
import { shelfSelectorFields } from './shelf-scope'
import { DOCUMENT_ID_LOOKUP_MAX_IDS } from './id-lookup'

const ids = z.array(z.guid()).min(1).max(DOCUMENT_ID_LOOKUP_MAX_IDS)

export const byIdRequestSchema = z.object({ ...shelfSelectorFields, ids })
