import { z } from 'zod'
import { pageQueryShape } from '@/lib/api/offset-page'
import { CALIBRATION_STATUSES } from './wire'

export const listCalibrationsQuerySchema = z
  .object({
    ...pageQueryShape,
    page: z.coerce.number().int().min(1).max(100_000).optional().describe('Only this page’s calibrations.'),
    status: z.enum(CALIBRATION_STATUSES).optional().describe('Default `active`.'),
  })
  .strict()
export type ListCalibrationsQuery = z.infer<typeof listCalibrationsQuerySchema>
