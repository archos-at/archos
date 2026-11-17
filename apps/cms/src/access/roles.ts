export const ROLES = ['admin', 'publisher', 'editor', 'agent', 'website', 'social-handoff'] as const;
export type Role = (typeof ROLES)[number];

export type Principal = { id?: number | string; role?: string | null } | null | undefined;

export const roleOf = (user: Principal): Role | undefined =>
  ROLES.find((role) => role === user?.role);

const holds = (roles: readonly Role[]) => (user: Principal) => {
  const role = roleOf(user);
  return role !== undefined && roles.includes(role);
};

export const canPublish = holds(['admin', 'publisher']);
export const canDraft = holds(['admin', 'publisher', 'editor', 'agent']);
export const canUseAdminPanel = holds(['admin', 'publisher', 'editor']);
export const isAdmin = holds(['admin']);
