import { z } from 'zod'
import { updateLessonSchema } from '@/lib/platform-lessons/types'
import type { AgentOperation } from '../operation'

const lessonParams = z.object({
  lessonId: z.string().describe('The lesson id (a uuid), from platform-lesson-list.'),
})

export const platformLessonOperations = [
  {
    name: 'platform-lesson-list',
    domain: 'platform',
    summary: 'List the platform lessons',
    description:
      'The fleet-wide lesson register distilled from answer feedback, every lesson with status counts. ' +
      'Lesson ids feed platform-lesson-get and platform-lesson-update.',
    method: 'GET',
    path: '/api/platform/lessons',
    load: () => import('@/app/api/platform/lessons/route'),
  },
  {
    name: 'platform-lesson-sweep-run',
    domain: 'platform',
    summary: 'Distil lessons from unprocessed down-votes',
    description:
      'Runs a catch-up sweep that turns unprocessed down-votes into candidate lessons. Needed after an outage or for old ' +
      'feedback; new votes are processed on their own. Returns the sweep result; then review with platform-lesson-list.',
    method: 'POST',
    path: '/api/platform/lessons',
    idempotent: true,
    load: () => import('@/app/api/platform/lessons/route'),
  },
  {
    name: 'platform-lesson-get',
    domain: 'platform',
    summary: 'Read one lesson with its trail and provenance',
    description:
      'One lesson with its append-only event trail and provenance rows (feedback ids, organization hashes, anonymized summaries; ' +
      'never the raw reports). Lesson ids come from platform-lesson-list.',
    method: 'GET',
    path: '/api/platform/lessons/[lessonId]',
    params: lessonParams,
    load: () => import('@/app/api/platform/lessons/[lessonId]/route'),
  },
  {
    name: 'platform-lesson-update',
    domain: 'platform',
    summary: 'Activate, retire or edit a lesson',
    description:
      'Moves a lesson to active or retired, rewrites its text, or records its root cause; send only the fields to change. ' +
      'An active lesson shapes answers for every organization. Audited.',
    method: 'PATCH',
    path: '/api/platform/lessons/[lessonId]',
    params: lessonParams,
    body: updateLessonSchema,
    idempotent: true,
    load: () => import('@/app/api/platform/lessons/[lessonId]/route'),
  },
] as const satisfies readonly AgentOperation[]
