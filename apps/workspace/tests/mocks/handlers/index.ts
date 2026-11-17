import { documentHandlers } from './documents'
import { inboxHandlers } from './inbox'
import { uploadScreeningHandlers } from './upload-screening'
import { userPreferencesHandlers } from './user-preferences'

export const handlers = [...documentHandlers, ...userPreferencesHandlers, ...uploadScreeningHandlers, ...inboxHandlers]

export { documentHandlers }
export { userPreferencesHandlers }
export { uploadScreeningHandlers }
export { resetDocumentMockState } from './documents'

export { resetDatabase } from '../database'
