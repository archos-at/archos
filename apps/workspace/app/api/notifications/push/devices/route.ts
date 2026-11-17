import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { listDevices, registerDevice } from '@/lib/push/service'
import { registerDeviceSchema } from '@/lib/push/types'

export const GET = apiRoute(async ({ session }) => ({ devices: await listDevices(session) }), {
  authz: { enforcedBy: 'listDevices (rows are keyed to session.userId)' },
})

export const POST = apiRoute(
  async ({ session, request }) => {
    const body = await parseJsonBody(request, registerDeviceSchema)
    return { device: await registerDevice(session, body, request.headers.get('user-agent')) }
  },
  { authz: { enforcedBy: 'registerDevice (rows are keyed to session.userId)' } }
)
