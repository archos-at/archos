import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import {
  assignableRolePermissions,
  createCustomRole,
  listOrganizationRoles,
} from '@/lib/authz/custom-roles'
import { createRoleSchema } from '@/lib/authz/role-wire'

export const GET = apiRoute(
  async ({ session }) => ({
    roles: await listOrganizationRoles(session),
    assignable: assignableRolePermissions(session),
  }),
  {
    authz: {
      sessionOnly: true,
      why: "role names are what a folder restriction and its lock show to every member of the organization; keyed by session.organizationId, permissions are withheld from non-managers by listOrganizationRoles, and every write requires org:members:manage",
    },
  }
)

export const POST = apiRoute(
  async ({ session, request }) => {
    const input = await parseJsonBody(request, createRoleSchema)
    return { role: await createCustomRole(session, input, request) }
  },
  { status: 201, authz: { permission: ORG_PERMISSIONS.membersManage } }
)
