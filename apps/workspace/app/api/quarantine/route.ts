import { apiRoute } from '@/lib/api/handler'
import { listQuarantineQueue } from '@/lib/upload-screening/review'

export const GET = apiRoute(async ({ session }) => ({ items: await listQuarantineQueue(session) }), {
  authz: {
    sessionOnly: true,
    why: 'the list is filtered per row by mayReviewQuarantine (org:projects:administer, project:manage on the project, org:office_shelf:manage), so a member without either sees an empty queue',
  },
})
