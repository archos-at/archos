import { describe, expect, it } from 'vitest'
import { INBOX_ITEM_TYPES, type InboxItemType } from '@/lib/db/schema/inbox'
import { LEGACY_AGENT_INBOX_TYPES, type LegacyAgentInboxType } from './legacy-agent-types'
import { canonicalInboxType, storedInboxTypesOf } from './types'
import { storedItem } from './canonical-rows'
import { inboxGroupKey } from './registry'
import { pushPolicyFor } from './push-policy'

const RENAMED = Object.entries(LEGACY_AGENT_INBOX_TYPES) as [LegacyAgentInboxType, InboxItemType][]

describe('agent inbox types under their new names', () => {
  it('lists each new type and none of the old ones among the inbox types', () => {
    for (const [legacy, current] of RENAMED) {
      expect(INBOX_ITEM_TYPES).toContain(current)
      expect(INBOX_ITEM_TYPES as readonly string[]).not.toContain(legacy)
    }
  })

  it('reads an old spelling as the new type, in a type filter, a push policy and an email default', () => {
    for (const [legacy, current] of RENAMED) {
      expect(canonicalInboxType(legacy)).toBe(current)
      expect(storedInboxTypesOf([current])).toEqual([current, legacy])
      expect(pushPolicyFor(legacy)).toEqual(pushPolicyFor(current))
      expect(pushPolicyFor(legacy)).not.toBeNull()
    }
  })

  it('writes and groups each type under its new spelling, whichever spelling it is handed', () => {
    for (const [legacy, current] of RENAMED) {
      const row = { organizationId: 'org_1', recipientUserId: 'user_1', resourceType: 'document', resourceId: 'doc_1', groupKey: 'k', actionable: true } as const
      expect(storedItem({ ...row, type: current }).type).toBe(current)
      expect(storedItem({ ...row, type: legacy }).type).toBe(current)
      expect(inboxGroupKey(current, 'document', 'doc_1', 'ann_1')).toBe(`${current}:document:doc_1:ann_1`)
    }
  })
})
