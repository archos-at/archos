import type { z } from 'zod'

type DiscriminatedUnion = z.ZodDiscriminatedUnion<readonly z.core.$ZodTypeDiscriminable[], string>

export function discriminatedOptions<U extends DiscriminatedUnion>(union: U): ReadonlyMap<unknown, U['options'][number]> {
  const key = union.def.discriminator
  const byValue = new Map<unknown, U['options'][number]>()
  for (const option of union.options) {
    for (const value of option._zod.propValues?.[key] ?? []) {
      if (value !== undefined) byValue.set(value, option)
    }
  }
  return byValue
}
