export type PermissionTier = 'org' | 'platform' | 'project' | 'folder'

export type RoleScope =
  | 'environment'
  | 'platform-org'

export interface PermissionSpec {
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly tier: PermissionTier
  readonly system?: true
  readonly deprecated?: true
}

export interface RoleSpec {
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly tier: PermissionTier
  readonly scope: RoleScope
  readonly permissions: readonly string[]
}

export interface ResourceTypeSpec {
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly parent: string | null
}

export const RESOURCE_TYPES: readonly ResourceTypeSpec[] = [
  {
    slug: 'organization',
    name: 'Organization',
    description: 'System resource type representing the organization level',
    parent: null,
  },
  {
    slug: 'project',
    name: 'Project',
    description:
      'A tenant workspace: shared documents, memory and conversations for the research agent.',
    parent: 'organization',
  },
  {
    slug: 'folder',
    name: 'Folder',
    description:
      'A project folder with its own access list, registered directly under its project. Access is a folder role assigned on it.',
    parent: 'project',
  },
]

export const ORG_PERMISSION_SPECS: readonly PermissionSpec[] = [
  {
    slug: 'org:settings:manage',
    name: 'Manage organization settings',
    description: 'Manage organization settings (name, locale, defaults).',
    tier: 'org',
  },
  {
    slug: 'org:models:manage',
    name: 'Manage AI models',
    description: 'Manage runtime AI model configuration per agent group (ADR-0014).',
    tier: 'org',
  },
  {
    slug: 'org:budgets:manage',
    name: 'Manage LLM budgets',
    description: 'Manage LLM budgets and view org-wide usage (ADR-0015).',
    tier: 'org',
  },
  {
    slug: 'org:compliance:manage',
    name: 'Manage compliance',
    description: 'Manage legal holds and the deletion queue.',
    tier: 'org',
  },
  {
    slug: 'org:audit:view',
    name: 'View audit trail',
    description: "Open the organization's native WorkOS audit-log viewer and exports.",
    tier: 'org',
  },
  {
    slug: 'org:downloads:view',
    name: 'View the download log',
    description:
      'Open the download log: who took which document out, and who opened one in a folder with its own access list. Reading it is itself recorded.',
    tier: 'org',
  },
  {
    slug: 'org:office_shelf:manage',
    name: 'Manage the office shelf',
    description:
      'Upload, delete, re-ingest and retag documents in the org-wide office shelf (ADR-0024). Reads stay open to every member.',
    tier: 'org',
  },
  {
    slug: 'org:archiv:manage',
    name: 'Manage the office shelf (old name)',
    description:
      'Retired name of org:office_shelf:manage. Retained so existing grants keep working; new roles take org:office_shelf:manage.',
    tier: 'org',
    deprecated: true,
  },
  {
    slug: 'org:skills:manage',
    name: 'Manage organization skills',
    description:
      'Author, edit, clone and delete skills in the organization toolbox (Agent Skills). Reads stay open to every member.',
    tier: 'org',
  },
  {
    slug: 'org:projects:create',
    name: 'Create projects',
    description:
      'Create new projects in the organization. Held by the default Member role; withhold it to make project creation an admin-only act.',
    tier: 'org',
  },
  {
    slug: 'org:projects:administer',
    name: 'Administer all projects',
    description:
      'Reach and administer every project in the organization without a per-project role. The org-admin bypass, as a permission a custom role can hold.',
    tier: 'org',
  },
  {
    slug: 'org:members:manage',
    name: 'Manage people and roles',
    description:
      'Open the Access tab: see every member and the role they hold, and invite, re-role or remove people.',
    tier: 'org',
  },
]

export const PLATFORM_PERMISSION_SPECS: readonly PermissionSpec[] = [
  {
    slug: 'platform:organizations:view',
    name: 'View all organizations',
    description:
      'Platform tier: see every organization on the platform (directory, members, activity).',
    tier: 'platform',
  },
  {
    slug: 'platform:organizations:manage',
    name: 'Manage any organization',
    description: 'Platform tier: administer any organization (settings, limits, lifecycle).',
    tier: 'platform',
  },
  {
    slug: 'platform:usage:view',
    name: 'View cross-org usage',
    description: 'Platform tier: cross-organization LLM usage, spend, and budget posture.',
    tier: 'platform',
  },
  {
    slug: 'platform:settings:view',
    name: 'View platform settings',
    description:
      'Platform tier: read platform-wide settings, defaults, the base knowledge corpus and the skill catalog. The read half of platform:settings:manage.',
    tier: 'platform',
  },
  { slug: 'platform:settings:manage', name: 'Manage platform settings', tier: 'platform',
    description: 'Platform tier: manage platform-wide settings and defaults (models, prices, retrieval); not the base knowledge corpus.' },
  { slug: 'platform:knowledge:write', name: 'Write platform knowledge', tier: 'platform',
    description: 'Platform tier: draft knowledge change requests (open, capture, propose, submit) and manage the base corpus (upload, sync, reingest). ADR-0165.' },
  { slug: 'platform:knowledge:review', name: 'Review platform knowledge', tier: 'platform',
    description: 'Platform tier: review, approve or reject, publish and roll back platform knowledge change requests (ADR-0165).' },
  ...(['domain_expert', 'counsel', 'privacy_reviewer'] as const).map((role) => ({
    slug: `platform:knowledge:approve_as_${role}`,
    name: `Approve knowledge as ${role.replaceAll('_', ' ')}`,
    description: `Platform tier: approve a platform knowledge change request in the ${role.replaceAll('_', ' ')} role.`,
    tier: 'platform' as const,
  })),
  { slug: 'platform:knowledge:approve_alone', name: 'Approve knowledge alone', tier: 'platform',
    description: 'Platform tier: approve a knowledge change request one wrote, with a reason, when no second person can. A second review stays due (ADR-0176).' },
  {
    slug: 'platform:observability:view',
    name: 'View LLM observability',
    description:
      'Platform tier: open Langfuse (traces, scores, cost) read-only. Gated at the edge; Langfuse roles decide the rest.',
    tier: 'platform',
  },
]

export const PROJECT_PERMISSION_SPECS: readonly PermissionSpec[] = [
  {
    slug: 'project:view',
    name: 'View project',
    description: 'Read and search a project, its documents and its conversations.',
    tier: 'project',
  },
  {
    slug: 'project:chat',
    name: 'Chat in project',
    description: 'Start and continue conversations scoped to this project.',
    tier: 'project',
  },
  {
    slug: 'project:edit',
    name: 'Edit project content',
    description:
      'Legacy umbrella write permission. Retained so existing grants keep working; new checks use project:documents:write or project:memory:write.',
    tier: 'project',
    deprecated: true,
  },
  {
    slug: 'project:documents:write',
    name: 'Write project documents',
    description: 'Upload, delete, re-ingest and retag documents inside a project.',
    tier: 'project',
  },
  {
    slug: 'project:documents:generate',
    name: 'File agent-authored documents',
    description:
      'Let the agent file documents it wrote — reports, diagrams — into a project. Required IN ADDITION to project:documents:write, never instead of it.',
    tier: 'project',
  },
  {
    slug: 'project:memory:write',
    name: 'Write project memory',
    description: "Add, edit and remove items in a project's long-term memory.",
    tier: 'project',
  },
  {
    slug: 'project:manage',
    name: 'Manage project',
    description: 'Rename, archive or delete the project itself.',
    tier: 'project',
  },
  {
    slug: 'project:members:manage',
    name: 'Manage project members',
    description: 'Grant and revoke project roles for other members of the organization.',
    tier: 'project',
  },
  {
    slug: 'project:skills:manage',
    name: 'Manage project skill schedules',
    description:
      'Create, edit, delete and run skill schedules in a project (Agent Skills Phase A). Reads stay open to every project viewer.',
    tier: 'project',
  },
]

export const FOLDER_PERMISSION_SPECS: readonly PermissionSpec[] = [
  {
    slug: 'folder:read',
    name: 'Read folder',
    description: 'See, open, download and search a folder with its own access list, and use it in answers.',
    tier: 'folder',
  },
  {
    slug: 'folder:write',
    name: 'Write folder',
    description: 'Change a folder with its own access list and what is filed in it. The project role still caps it.',
    tier: 'folder',
  },
]

export const WIDGET_PERMISSION_SPECS: readonly PermissionSpec[] = [
  {
    slug: 'widgets:users-table:manage',
    name: 'Manage users',
    description: 'View and edit access for the users table widget.',
    tier: 'org',
    system: true,
  },
  {
    slug: 'widgets:sso:manage',
    name: 'Manage Single Sign-On connections',
    description: 'View and manage access for the Single Sign-On (SSO) widget.',
    tier: 'org',
    system: true,
  },
  {
    slug: 'widgets:dsync:manage',
    name: 'Manage Directory Sync',
    description: 'View and manage access for the Directory Sync widget.',
    tier: 'org',
    system: true,
  },
  {
    slug: 'widgets:domain-verification:manage',
    name: 'Manage domains',
    description: 'View and manage access for the domain verification widget.',
    tier: 'org',
    system: true,
  },
  {
    slug: 'widgets:audit-log-streaming:manage',
    name: 'Manage audit log streaming',
    description: 'View and manage access for the audit log streaming widget.',
    tier: 'org',
    system: true,
  },
  {
    slug: 'widgets:pipes:manage',
    name: 'Manage Pipes',
    description: 'View and manage access for the Pipes integrations widget.',
    tier: 'org',
    system: true,
  },
]

export const ALL_PERMISSION_SPECS: readonly PermissionSpec[] = [
  ...ORG_PERMISSION_SPECS,
  ...PLATFORM_PERMISSION_SPECS,
  ...PROJECT_PERMISSION_SPECS,
  ...FOLDER_PERMISSION_SPECS,
  ...WIDGET_PERMISSION_SPECS,
]

const ORG_WIDGET_SLUGS = WIDGET_PERMISSION_SPECS.map((permission) => permission.slug)

export const ROLES: readonly RoleSpec[] = [
  {
    slug: 'member',
    name: 'Member',
    description:
      'The default user role. May create projects; all other project access comes from project-scoped roles.',
    tier: 'org',
    scope: 'environment',
    permissions: ['org:projects:create'],
  },
  {
    slug: 'admin',
    name: 'Admin',
    description:
      'Full administration of one organization. Holds every org: permission; never any platform: permission.',
    tier: 'org',
    scope: 'environment',
    permissions: [
      ...ORG_PERMISSION_SPECS.map((permission) => permission.slug),
      ...ORG_WIDGET_SLUGS,
    ],
  },
  {
    slug: 'org-auditor',
    name: 'Auditor',
    description:
      'Read-only compliance persona: opens the organization’s audit trail and nothing else. Cannot change settings, budgets, models or data.',
    tier: 'org',
    scope: 'environment',
    permissions: ['org:audit:view'],
  },
  {
    slug: 'org-billing-admin',
    name: 'Billing Admin',
    description:
      'FinOps persona: sets LLM budget policies and sees org-wide spend. No access to settings, models, data or the audit trail.',
    tier: 'org',
    scope: 'environment',
    permissions: ['org:budgets:manage'],
  },
  {
    slug: 'org-compliance-officer',
    name: 'Compliance Officer',
    description:
      'Legal/DPO persona: places and releases legal holds, drives the deletion queue, and reads the audit trail. No settings, budgets or model access.',
    tier: 'org',
    scope: 'environment',
    permissions: ['org:compliance:manage', 'org:audit:view'],
  },
  {
    slug: 'org-knowledge-manager',
    name: 'Knowledge Manager',
    description:
      'Curates the org-wide office shelf: upload, delete, re-ingest, retag. No other administrative access.',
    tier: 'org',
    scope: 'environment',
    permissions: ['org:office_shelf:manage', 'org:archiv:manage'],
  },
  {
    slug: 'org-user-admin',
    name: 'User Admin',
    description:
      'IT-helpdesk persona: manages who is in the organization and what role they hold, without seeing budgets, models, compliance or settings.',
    tier: 'org',
    scope: 'environment',
    permissions: ['org:members:manage', 'widgets:users-table:manage'],
  },

  {
    slug: 'org-platform-owner',
    name: 'Platform Owner',
    description:
      'Exclusive to the GRID Platform organization: full cross-organization oversight of the platform. Not assignable in tenant organizations.',
    tier: 'platform',
    scope: 'platform-org',
    permissions: [
      ...PLATFORM_PERMISSION_SPECS.map((permission) => permission.slug),
      'widgets:users-table:manage',
      'widgets:sso:manage',
      'widgets:dsync:manage',
      'widgets:domain-verification:manage',
      'widgets:audit-log-streaming:manage',
    ],
  },
  {
    slug: 'org-platform-support',
    name: 'Platform Support',
    description:
      'Read-only platform staff: sees every organization and cross-org usage, changes nothing. Exclusive to the GRID Platform organization.',
    tier: 'platform',
    scope: 'platform-org',
    permissions: [
      'platform:organizations:view',
      'platform:usage:view',
      'platform:settings:view',
      'platform:observability:view',
    ],
  },
  {
    slug: 'org-platform-observability-analyst',
    name: 'Observability Analyst',
    description:
      'Read-only Langfuse for business analysts and the Fachbereich: traces, scores and cost, nothing else. Exclusive to the GRID Platform organization.',
    tier: 'platform',
    scope: 'platform-org',
    permissions: ['platform:observability:view'],
  },

  {
    slug: 'project-viewer',
    name: 'Project Viewer',
    description: 'Read-only on one project: its documents, memory and conversations.',
    tier: 'project',
    scope: 'environment',
    permissions: ['project:view'],
  },
  {
    slug: 'project-contributor',
    name: 'Project Contributor',
    description:
      'May use the research agent in one project but not change its corpus: chat and read, no document or memory writes.',
    tier: 'project',
    scope: 'environment',
    permissions: ['project:view', 'project:chat'],
  },
  {
    slug: 'project-editor',
    name: 'Project Editor',
    description:
      'Full working access to one project: chat, documents and memory. Cannot rename or delete the project, manage its members, or create skill schedules.',
    tier: 'project',
    scope: 'environment',
    permissions: [
      'project:view',
      'project:chat',
      'project:edit',
      'project:documents:write',
      'project:documents:generate',
      'project:memory:write',
    ],
  },
  {
    slug: 'project-admin',
    name: 'Project Admin',
    description:
      'Administers one project: everything an editor can do, plus renaming/deleting it, managing its members, and creating skill schedules.',
    tier: 'project',
    scope: 'environment',
    permissions: [
      'project:view',
      'project:chat',
      'project:edit',
      'project:documents:write',
      'project:documents:generate',
      'project:memory:write',
      'project:manage',
      'project:members:manage',
      'project:skills:manage',
    ],
  },

  {
    slug: 'folder-reader',
    name: 'Folder Reader',
    description: 'Reads one folder with its own access list: open, download, search, and use in answers.',
    tier: 'folder',
    scope: 'environment',
    permissions: ['folder:read'],
  },
  {
    slug: 'folder-editor',
    name: 'Folder Editor',
    description: 'Reads and changes one folder with its own access list. The project role still caps writing.',
    tier: 'folder',
    scope: 'environment',
    permissions: ['folder:read', 'folder:write'],
  },
]

export function findPermissionSpec(slug: string): PermissionSpec | undefined {
  return ALL_PERMISSION_SPECS.find((permission) => permission.slug === slug)
}

export function findRoleSpec(slug: string): RoleSpec | undefined {
  return ROLES.find((role) => role.slug === slug)
}
