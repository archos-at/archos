/**
 * Who may do what (ADR-0155). One role per user; the rules below are the whole
 * of it, and `tests/editorial.test.ts` holds them.
 *
 * | Role             | Who                                   | May                                                      |
 * |------------------|---------------------------------------|----------------------------------------------------------|
 * | `admin`          | a person who runs the CMS             | everything, and manage users and MCP keys                 |
 * | `publisher`      | a person                              | publish, unpublish, schedule, delete; approve social posts |
 * | `editor`         | a person                              | write drafts, send them to review                         |
 * | `agent`          | an AI agent, through the API or MCP   | what an editor may, without the admin panel               |
 * | `website`        | the website's server (API key)        | read what is live                                         |
 * | `social-handoff` | the Buffer hand-off (API key)         | claim an approved social post, mark it scheduled or failed |
 */

export const ROLES = ['admin', 'publisher', 'editor', 'agent', 'website', 'social-handoff'] as const;
export type Role = (typeof ROLES)[number];

/** A signed-in user as access functions see it; `null` for an anonymous request. */
export type Principal = { id?: number | string; role?: string | null } | null | undefined;

export const roleOf = (user: Principal): Role | undefined =>
  ROLES.find((role) => role === user?.role);

const holds = (roles: readonly Role[]) => (user: Principal) => {
  const role = roleOf(user);
  return role !== undefined && roles.includes(role);
};

/** Publish, unpublish, schedule, delete, approve: people, and only these two roles. */
export const canPublish = holds(['admin', 'publisher']);
/** Write drafts. */
export const canDraft = holds(['admin', 'publisher', 'editor', 'agent']);
/** Sign in to the admin panel: people only. An agent works through the API and MCP. */
export const canUseAdminPanel = holds(['admin', 'publisher', 'editor']);
export const isAdmin = holds(['admin']);
