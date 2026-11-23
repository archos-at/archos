import { vi } from 'vitest'
import type { BimModelHeaderView } from '../hooks/use-bim-model'

export const routerReplace = vi.fn()
export const sourceReload = vi.fn()
export const modelsReload = vi.fn()

export const state = {
  models: [] as BimModelHeaderView[],
  elements: [] as unknown[],
  elementsLoading: false,
  detail: null as unknown,
  sourceUrl: 'https://example.test/haus-a.ifc' as string | null,
  sourceError: null as string | null,
}

export function model(overrides: Partial<BimModelHeaderView> = {}): BimModelHeaderView {
  return {
    id: 'm-1',
    documentId: 'doc-1',
    projectId: 'p1',
    filename: 'Haus-A.ifc',
    displayName: null,
    status: 'ready',
    schemaVersion: 'IFC4',
    elementCount: 120,
    errorMessage: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    summary: {
      storeys: [
        { globalId: null, expressId: 1, name: 'Erdgeschoss', elevation: 0, elementCount: 80 },
        { globalId: null, expressId: 2, name: 'Obergeschoss', elevation: 3.2, elementCount: 40 },
      ],
    } as BimModelHeaderView['summary'],
    ...overrides,
  }
}

export function lastQuery(): URLSearchParams {
  const href = routerReplace.mock.calls.at(-1)?.[0] as string | undefined
  return new URLSearchParams(href?.split('?')[1] ?? '')
}

export function setWebGpu(available: boolean): void {
  if (available) Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true })
  else if ('gpu' in navigator) Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'gpu')
}
