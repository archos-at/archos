import { z } from 'zod'
import { shelfSelectorFields } from './shelf-scope'

export const DOCUMENT_ID_LOOKUP_MAX_IDS = 200

const ids = z.array(z.guid()).min(1).max(DOCUMENT_ID_LOOKUP_MAX_IDS)

export const byIdRequestSchema = z.object({ ...shelfSelectorFields, ids })
