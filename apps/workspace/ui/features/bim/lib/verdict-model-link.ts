import { buildModelHref } from './model-link'

export function verdictHref(
  projectId: string,
  modelFilename: string,
  globalIds: string[],
  status: 'fail' | 'info'
): string {
  return buildModelHref(projectId, {
    model: modelFilename,
    element: globalIds[0],
    highlights: [{ status, globalIds }],
    xray: true,
    tab: 'compliance',
  })
}
