export const SHAREABLE_RESOURCE_TYPES = ['conversation', 'document'] as const
export type ShareableResourceType = (typeof SHAREABLE_RESOURCE_TYPES)[number]

export const RESOURCE_ROLES = ['viewer', 'collaborator', 'owner'] as const
export type ResourceRole = (typeof RESOURCE_ROLES)[number]

export const RESOURCE_VISIBILITIES = ['private', 'project', 'organization'] as const
export type ResourceVisibility = (typeof RESOURCE_VISIBILITIES)[number]
