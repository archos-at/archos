export type ProjectRole = 'project-viewer' | 'project-contributor' | 'project-editor' | 'project-admin'

export interface Member {
  organizationMembershipId: string
  userId: string
  email: string | null
  name: string
  profilePictureUrl: string | null
  role: ProjectRole | null
}
