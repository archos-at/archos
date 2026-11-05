# Project Access Control (WorkOS FGA)

Who may do what in a project is decided by WorkOS Fine-Grained Authorization
(FGA). Each project is a WorkOS `project` resource; a person's access is a
project role assigned to their organization membership on it. Every gate asks a
**permission**, never a role name (ADR-0038). The decision point is
`apps/workspace/bff/authz/projects.ts` (`requireProjectAccess`), surfaced as a
named decision through `bff/authz/decide.ts`.

## Creating a project

`createProject` (`bff/projects/service.ts`), behind `org:projects:create`:

1. Inserts the `projects` row with a generated `collectionName` (`proj_{uuid}`).
2. Registers the WorkOS resource (`authorization.createResource`, `resourceTypeSlug: 'project'`, `externalId` = the project id) and stores its id in `workosResourceId`.
3. Assigns the creator `project-admin` on it.

A failure at any later step is undone in both systems
(`bff/projects/project-creation-undo.ts`): the WorkOS resource is deleted by its
external id with `cascadeDelete`, which removes the creator's assignment too,
and then the row. Purging a deleted project deletes the resource the same way
(`purger/purge-project.js`).

## The check (`requireProjectAccess`)

```typescript
export async function requireProjectAccess(
  session: AuthorizedSession,
  projectId: string,
  permission: ProjectPermission | readonly ProjectPermission[] = 'project:view', // any-of
  options?: { includeDeleted?: boolean; evenWhenClosed?: boolean },
): Promise<ProjectAccess> // { role, closed, readsBecauseClosed }
```

In order:

1. **Tenancy.** The project is read from Postgres. Missing, in another
   organization, or soft-deleted (unless `includeDeleted`): `NotFoundError`.
   This runs for everyone, organization admins included.
2. **Closed project** (ADR-0090). Of the requested permissions only those in
   `CLOSED_PROJECT_KEEPS` (`project:view`, `project:chat`,
   `project:members:manage`) remain; if none does, the request is refused with
   `projectClosedError()` (403, `reason: 'project-closed'`). This runs before the
   bypass, so an admin is refused too. `evenWhenClosed` asks `project:manage` as
   if the project were active, for the acts on a closed project as a whole:
   reopening, deleting and restoring it, restoring from its Papierkorb, erasing
   from its record.
3. **Organization-wide bypass.** A session whose token carries
   `org:projects:administer` gets `project-admin`.
4. **Effective permissions.** One WorkOS call,
   `authorization.listEffectivePermissionsByExternalId`, for the session's
   membership on the project (roles on the project and its ancestors).
   `effectiveResourcePermissions` in `bff/authz/resource-check.ts`; cached, see
   below. A failed call grants nothing and is not cached.
5. **Grant.** Holding any one of the remaining requested permissions grants
   access. If the caller holds none but the project is closed and every
   requested permission is open to the whole organization (`project:view`,
   `project:chat`), access is granted as `project-viewer` with
   `readsBecauseClosed: true`. Otherwise `NotFoundError`, never `ForbiddenError`,
   so a response does not confirm that the project exists.
6. **Derived role**, read from what the caller holds, not from what was asked:
   `project:manage` → `project-admin`; any of `project:edit`,
   `project:documents:write`, `project:memory:write` → `project-editor`;
   otherwise `project-viewer`.

`readsBecauseClosed` answers for the permission asked: a Project Viewer
(`project:view` only) asking to chat in a closed project gets `true`, because
the chat is the closure's. Such a caller steers no run but their own and signs
no project on a job request. Folder clearance asks a different question,
whether the caller holds any grant on the project (`clearanceOf` in
`bff/authz/folder-access.ts`): that viewer keeps their folder roles, and only
someone with no grant at all clears what a member with no folder role clears.

## Permissions

The catalog is `bff/authz/catalog.ts`; the deploy applies it to WorkOS.

| Slug | Gates |
|------|-------|
| `project:view` | Opening the project, its documents, memory and conversations |
| `project:chat` | Chatting in the project (`CHAT_PERMISSIONS` = `project:chat` or the legacy `project:edit`) |
| `project:edit` | Legacy umbrella write; accepted beside the narrow writes so roles provisioned before the split keep working |
| `project:documents:write` | Uploading, deleting, re-ingesting and retagging documents |
| `project:documents:generate` | The agent filing what it wrote into the project (in addition to `project:documents:write`) |
| `project:memory:write` | The project's long-term memory |
| `project:manage` | Renaming, closing and reopening, deleting and restoring the project, folder access |
| `project:members:manage` | Granting and revoking project roles |
| `project:skills:manage` | Skill schedules |

Built-in roles: `project-viewer` (view), `project-contributor` (view, chat),
`project-editor` (everything but manage, members and skills), `project-admin`
(everything). Custom roles made in the product are organization-tier only
(`bff/authz/custom-roles.ts`); a project role made in the WorkOS dashboard is
read through the same permissions.

## Where it is enforced

| Action | Route | Permission |
|--------|-------|------------|
| List projects | `GET /api/projects`, the projects page | `project:view` per project (`projectsHolding`, the same cached answer); closed projects listed for every member |
| Create a project | `POST /api/projects` | `org:projects:create` |
| View a project | `GET /api/projects/[id]`, the project layout | `project:view` |
| Rename | `PATCH /api/projects/[id]` | `project:manage` |
| Delete / restore | `DELETE /api/projects/[id]`, `POST /api/projects/[id]/restore` | `project:manage` (`evenWhenClosed`) |
| Close / reopen / pause | `/api/projects/[id]/status` | `project:manage` (`evenWhenClosed`) |
| Roster, add, change, remove | `/api/projects/[id]/members`, `/api/projects/[id]/members/[assignmentId]` | `project:members:manage` or `project:manage` |
| Chat scope | `GET /api/auth/websocket-scope` and every chat request's collection scope | `CHAT_PERMISSIONS` |
| v1 proxy | `/api/v1/[...path]` (`bff/proxy/collection-authz.ts`) | `project:documents:write` or `project:edit` for `proj_*`; uploads and whole-collection deletes refused |

## Changing who is a member

`bff/projects/members-service.ts`. The members form changes and removes people
through `POST /members` (an empty `roleSlug` removes); the agent door also
offers `DELETE /members/[assignmentId]`. Both routes go through the same rules:

- **Serialized.** The roster is read, checked and written under a Postgres
  advisory lock on the project (`withProjectMembersLock`), so two changes cannot
  both pass the last-admin rule on the same stale list.
- **Last admin.** A change that would leave no `project-admin` is refused
  (409, `reason: 'last-admin'`).
- **Grant ceiling.** A caller may only grant or take away a role whose
  permissions they hold on the project themselves (403,
  `reason: 'role-exceeds-own'`); a role the catalog does not know counts as
  holding every project permission. The organization-wide bypass holds them all.
  Built-in roles never meet it: only Project Admin holds
  `project:members:manage`, and it holds everything.
- **Assign, then remove.** A member holds one direct project role. The new one
  is assigned before the others are removed, so a failure part-way leaves the
  old access, never none. A role a directory group carries is not touched.
- **Seen at once.** Every change forgets the person's cached grants
  (`forgetResourceGrants`), whether or not WorkOS completed.
- **Leaving.** When a change leaves someone with no role on the project, the
  collaboration waiting on them is voided (`revokeCollaborationForProjectMember`)
  and the Steckbrief keeps them as a former member (ADR-0091).
- **Audited.** `project.role.assigned` / `project.role.removed`.

The roster lists the people holding a project role and, per row, the direct
assignment that removes it. Organization admins reach every project through the
bypass and are not on it.

## The cache

`AUTHZ_CACHE_TTL_MS` (default 30 s, `0` turns it off) caches what a membership
holds on a resource, under
`authz:effective:{org}:{membership}:{generation}:{type}:{id}`. The generation is
per membership: a role change made in the product starts a new one, so the
change is seen on the person's next request and a lookup in flight during it
cannot cache the old answer back. Changes made outside the product (the WorkOS
dashboard, a directory sync) wait out the TTL. The gate, the project listing,
folder clearance and the pickers that ask about another person
(`userHoldsProjectPermission`) all read this one cached answer.

## Anonymous mode

With `REQUIRE_AUTH` not `true` there is no session and the project checks do not
run. The v1 proxy still refuses writes into `proj_*` collections without a
session.
