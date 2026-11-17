'use client'

import { useMemo, type FC } from 'react'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { lookStepGroups, type LookStepGroup } from '../../lib/look-steps'
import { lookGroupRow } from '../../lib/work-list'
import { WorkRowView } from './WorkList'

export { LookStrip } from './LookStrip'

export const LookStepRow: FC<{ group: LookStepGroup; eager?: boolean }> = ({ group, eager }) => (
  <WorkRowView row={lookGroupRow(group)} eager={eager} />
)

export const LookStepRows: FC<{ steps: readonly StoredThinkingStep[]; eager?: boolean }> = ({
  steps,
  eager,
}) => {
  const groups = useMemo(() => lookStepGroups(steps), [steps])
  if (groups.length === 0) return null
  return (
    <ul data-testid="look-step-rows" className="flex flex-col">
      {groups.map((group) => (
        <LookStepRow key={group.key} group={group} eager={eager} />
      ))}
    </ul>
  )
}
