export interface ServerSideListing {
  ids: string[]
  since: number
}

export const serverSideKey = (place: 'personal' | 'project', projectId?: string | null): string => `${place}:${projectId ?? ''}`
