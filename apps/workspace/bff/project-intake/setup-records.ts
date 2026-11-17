import 'server-only'
import { cache } from 'react'
import { withShippedFallback } from '@/lib/base-knowledge/rulesets/shipped'
import { readSetupRulesetsInForce } from '@/lib/base-knowledge/store/rulesets'
import type { StoredRuleset } from '@/lib/base-knowledge/rulesets/select'

export const readSetupRecords = cache(async (organizationId: string): Promise<readonly StoredRuleset[]> => {
  const read = await readSetupRulesetsInForce(organizationId)
  if (read.truncated || read.unreadable.length > 0) {
    console.error('[setup_records_read=false] the setup records could not be read completely; none is used', {
      organizationId,
      truncated: read.truncated,
      unreadable: read.unreadable,
    })
    return withShippedFallback([])
  }
  return withShippedFallback(read.rulesets)
})
