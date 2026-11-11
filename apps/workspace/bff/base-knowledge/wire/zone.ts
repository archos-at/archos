/** An IANA time zone the runtime knows: what "today" in a territory is read in. */

import { z } from 'zod'

export const zoneSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+){1,2}$/, 'an IANA time zone name such as Area/City')
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: zone })
      return true
    } catch {
      return false
    }
  }, 'a time zone this runtime knows')
