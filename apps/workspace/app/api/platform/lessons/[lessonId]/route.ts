import { z } from 'zod'
import { NotFoundError } from '@/lib/api/errors'
import { parseJsonBody } from '@/lib/api/handler'
import { platformApiRoute } from '@/lib/api/platform-handler'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { getLessonProvenance, updateLesson } from '@/lib/platform-lessons/service'
import { updateLessonSchema } from '@/lib/platform-lessons/types'

const lessonIdSchema = z.guid()

function parseLessonId(params: { lessonId?: string | string[] }): string {
  const parsed = lessonIdSchema.safeParse(params.lessonId)
  if (!parsed.success) throw new NotFoundError('Unknown lesson.')
  return parsed.data
}

export const GET = platformApiRoute<{ lessonId?: string | string[] }>(
  async ({ session, params }) => {
    return getLessonProvenance(session, parseLessonId(params))
  },
  { permission: PLATFORM_PERMISSIONS.settingsView }
)

export const PATCH = platformApiRoute<{ lessonId?: string | string[] }>(
  async ({ session, request, params }) => {
    const input = await parseJsonBody(request, updateLessonSchema)
    return { lesson: await updateLesson(session, parseLessonId(params), input, request) }
  },
  { permission: PLATFORM_PERMISSIONS.settingsManage }
)
