import { internalApiRoute } from '@/lib/api/handler'
import { reconcileOrphanedVectors } from '@/lib/platform/vector-reconcile'

export const POST = internalApiRoute(
  'VectorReconcile',
  () => reconcileOrphanedVectors(),
  {
    tenancy: {
      crossTenant:
        'every collection in the deployment is compared against the document catalog across ' +
        'organizations; the reconciler steps up itself (withPlatformAccess) for that one read, and ' +
        'the vector-store calls carry no tenant; the project facts half lists every live project the same way ' +
        '(listProjectFactsPage) and reads each project’s folders under its own organization',
    },
  },
)
