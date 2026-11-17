export interface LegacyRoute {
  from: string
  to: string
}

const OFFICE_SHELF_DOCUMENT_ROUTES: readonly LegacyRoute[] = ['/api/office-shelf/documents', '/api/archiv/documents'].flatMap(
  (prefix) => [
    ...['summary', 'by-name', 'name-matches', 'revision-candidates', 'upload'].map((name) => ({
      from: `${prefix}/${name}`,
      to: `/api/documents/${name}?scope=office_shelf`,
    })),
    { from: `${prefix}/fassung-candidates`, to: '/api/documents/revision-candidates?scope=office_shelf' },
    { from: `${prefix}/:id`, to: '/api/documents/:id' },
    { from: prefix, to: '/api/documents?scope=office_shelf' },
  ]
)

export const LEGACY_ROUTES: readonly LegacyRoute[] = [
  ...OFFICE_SHELF_DOCUMENT_ROUTES,
  { from: '/api/documents/:id/versions/:versionId/file', to: '/api/documents/:id/file?versionId=:versionId' },
  { from: '/api/documents/:id/fassung', to: '/api/documents/:id/revision' },
  { from: '/api/documents/:id/fassung-compare', to: '/api/documents/:id/revision-compare' },
  { from: '/api/documents/fassung-candidates', to: '/api/documents/revision-candidates' },
  { from: '/api/projects/:id/steckbrief', to: '/api/projects/:id/project-record' },
  { from: '/api/projects/:id/jobs', to: '/api/projects/:id/tasks' },
  { from: '/api/projects/:id/jobs/:taskId', to: '/api/projects/:id/tasks/:taskId' },
  { from: '/api/projects/:id/jobs/:taskId/run', to: '/api/projects/:id/tasks/:taskId/run' },
  { from: '/api/projects/:id/jobs/:taskId/runs', to: '/api/projects/:id/runs?taskId=:taskId' },
  { from: '/api/projects/:id/tasks/:runId/review', to: '/api/projects/:id/runs/:runId/review' },
  { from: '/api/piloti-asks/:id/cancel', to: '/api/agent-asks/:id/cancel' },
  { from: '/api/piloti-asks/:id', to: '/api/agent-asks/:id' },
  { from: '/api/piloti-asks', to: '/api/agent-asks' },
]
