import 'server-only'
import { v5 as uuidv5 } from 'uuid'
import { captureServer } from '@/lib/analytics/posthog-server'
import { isUniqueViolation } from '@/lib/db/errors'
import { withTenant } from '@/lib/db/tenant-context'
import { mayOpenDocument } from '@/lib/documents/may-open'
import { addCalendarDays, calendarDayIn, OFFICE_TIME_ZONE } from '@/lib/format'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { readGroupPayloads } from '@/lib/inbox/repository'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { emptyDueReminderCounts, type AnnotationDueRemindersPayload, type JobSliceResult } from '@/lib/jobs-queue/types'
import { onMarkDue, remindedFor, type DueReminder } from './attention'
import { listDueMarksPage, listOrganizationsWithDueMarks, type DueMark, type DueWindow } from './due-repository'

export const DUE_REMINDER_PAGE = 100

export const DUE_REMINDER_MAX_ORGANIZATIONS = 1000

export const DUE_REMINDER_OVERDUE_DAYS = 7

export function dueWindowOn(day: string): DueWindow {
  return { from: addCalendarDays(day, -DUE_REMINDER_OVERDUE_DAYS), through: addCalendarDays(day, 1) }
}

export function reminderOn(dueOn: string, today: string): DueReminder | null {
  if (dueOn < today) return 'overdue'
  return dueOn <= addCalendarDays(today, 1) ? 'due_soon' : null
}

export function dueReminderJobId(organizationId: string, day: string): string {
  return uuidv5(`grid:annotation-due:${organizationId}:${day}`, uuidv5.URL)
}

export interface DueReminderSweep {
  day: string
  organizations: number
  queued: number
  already: number
}

export async function enqueueDueReminders(now: Date = new Date()): Promise<DueReminderSweep> {
  const day = calendarDayIn(OFFICE_TIME_ZONE, now)
  const organizations = await listOrganizationsWithDueMarks(dueWindowOn(day), day, DUE_REMINDER_MAX_ORGANIZATIONS)
  if (organizations.length >= DUE_REMINDER_MAX_ORGANIZATIONS) {
    console.warn(
      `[annotations] due reminders for ${day}: the cap of ${DUE_REMINDER_MAX_ORGANIZATIONS} organizations was reached; ` +
        'the rest wait for a later day'
    )
  }
  const sweep: DueReminderSweep = { day, organizations: organizations.length, queued: 0, already: 0 }
  const failed: string[] = []
  for (const organizationId of organizations) {
    try {
      await withTenant({ organizationId }, () =>
        enqueueJob({
          kind: 'annotation_due_reminders',
          organizationId,
          payload: { day, cursor: null, counts: emptyDueReminderCounts() },
          jobId: dueReminderJobId(organizationId, day),
        })
      )
      sweep.queued += 1
    } catch (error) {
      if (isUniqueViolation(error, 'bff_job_queue_pkey')) sweep.already += 1
      else {
        console.warn(`[annotations] could not queue the due reminders of ${organizationId}:`, error)
        failed.push(organizationId)
      }
    }
  }
  if (failed.length > 0) {
    throw new Error(`due reminders for ${day}: ${failed.length} of ${organizations.length} organization(s) could not be queued`)
  }
  return sweep
}

async function reachable(organizationId: string, marks: readonly DueMark[]): Promise<Map<string, ReadonlySet<string>>> {
  const byDocument = new Map<string, DueMark[]>()
  for (const mark of marks) byDocument.set(mark.documentId, [...(byDocument.get(mark.documentId) ?? []), mark])
  const verdicts = await Promise.all(
    [...byDocument].map(async ([documentId, onIt]) => {
      const allowed = await mayOpenDocument(
        { organizationId },
        onIt[0].document,
        onIt.map((mark) => mark.assigneeUserId)
      ).catch(() => new Set<string>())
      return [documentId, allowed] as const
    })
  )
  return new Map(verdicts)
}

const groupKeyOf = (mark: DueMark) => inboxGroupKey('annotation.assigned_to_you', 'document', mark.documentId, mark.id)

export async function runDueRemindersSlice(
  organizationId: string,
  payload: AnnotationDueRemindersPayload
): Promise<JobSliceResult<AnnotationDueRemindersPayload>> {
  const page = await listDueMarksPage(organizationId, dueWindowOn(payload.day), payload.cursor, DUE_REMINDER_PAGE)
  const counts = { ...payload.counts }
  const [stamps, allowed] = await Promise.all([
    readGroupPayloads(
      organizationId,
      page.map((mark) => ({ recipientUserId: mark.assigneeUserId, groupKey: groupKeyOf(mark) }))
    ),
    reachable(organizationId, page),
  ])
  for (const mark of page) {
    counts.checked += 1
    const reminder = reminderOn(mark.dueOn, payload.day)
    if (!reminder) continue
    if (stamps.get(`${mark.assigneeUserId}\n${groupKeyOf(mark)}`)?.reminder === remindedFor(reminder, mark.dueOn)) {
      counts.already += 1
      continue
    }
    if (!allowed.get(mark.documentId)?.has(mark.assigneeUserId)) {
      counts.unreachable += 1
      continue
    }
    try {
      await onMarkDue({
        organizationId,
        documentId: mark.documentId,
        annotationId: mark.id,
        annotationNumber: mark.number,
        projectId: mark.document.projectId ?? null,
        assigneeUserId: mark.assigneeUserId,
        dueOn: mark.dueOn,
        reminder,
        markText: mark.body,
      })
      if (reminder === 'overdue') counts.overdue += 1
      else counts.dueSoon += 1
    } catch (error) {
      counts.failed += 1
      console.warn(`[annotations] could not remind the Zuständige of mark ${mark.id}:`, error)
    }
  }
  const next: AnnotationDueRemindersPayload = { day: payload.day, cursor: page.at(-1)?.id ?? payload.cursor, counts }
  const done = page.length < DUE_REMINDER_PAGE
  if (done) {
    captureServer({
      event: 'annotation_due_reminders_sent',
      distinctId: null,
      organizationId,
      properties: {
        checked: counts.checked,
        due_soon: counts.dueSoon,
        overdue: counts.overdue,
        already: counts.already,
        unreachable: counts.unreachable,
        failed: counts.failed,
      },
    })
  }
  return { done, payload: next }
}
