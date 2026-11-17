import 'server-only'

import { bestEffortInbox } from '@/lib/inbox/best-effort'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { emitInboxItems, resolveInboxItemsAnchoredOn } from '@/lib/inbox/service'

const TYPE = 'agent.intake_ready'

const SUMMARY_LENGTH = 200

export async function onIntakeReady(input: {
  organizationId: string
  projectId: string
  intakeId: string
  recipientUserId: string
  projectName: string | null
  outcome: 'ready' | 'failed'
  decisiveOpen: number
  summary: string | null
}): Promise<void> {
  await bestEffortInbox(`${TYPE} for intake ${input.intakeId}`, input.organizationId, () => {
    const summary = (input.summary ?? '').replace(/\s+/g, ' ').trim()
    return emitInboxItems([
      {
        organizationId: input.organizationId,
        recipientUserId: input.recipientUserId,
        type: TYPE,
        resourceType: 'project',
        resourceId: input.projectId,
        anchorId: input.intakeId,
        actorUserId: null,
        groupKey: inboxGroupKey(TYPE, 'project', input.projectId, input.intakeId),
        payload: {
          ...(input.projectName ? { subject: input.projectName } : {}),
          variant: input.outcome,
          related: input.outcome === 'ready' && input.decisiveOpen > 0 ? String(input.decisiveOpen) : '',
          excerpt: summary.length > SUMMARY_LENGTH ? `${summary.slice(0, SUMMARY_LENGTH - 1)}…` : summary,
        },
      },
    ])
  })
}

export async function onIntakeCompleted(input: { organizationId: string; intakeId: string }): Promise<void> {
  await bestEffortInbox(`settling intake ${input.intakeId}`, input.organizationId, () =>
    resolveInboxItemsAnchoredOn({ organizationId: input.organizationId, types: [TYPE], anchorId: input.intakeId })
  )
}
