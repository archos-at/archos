import { vi } from 'vitest'
import { isDrawingRenditionSource } from '@/lib/documents/preview-types'

type RenditionModule = typeof import('@/lib/documents/rendition')

export function renditionModuleMock(actual: RenditionModule, officeConversionEnabled: boolean): RenditionModule {
  const isRenditionEnabled = vi.fn<RenditionModule['isRenditionEnabled']>().mockReturnValue(officeConversionEnabled)
  return {
    ...actual,
    isRenditionEnabled,
    isRenditionEnabledFor: vi.fn<RenditionModule['isRenditionEnabledFor']>(
      (file) => isDrawingRenditionSource(file) || isRenditionEnabled()
    ),
    ensureRendition: vi.fn<RenditionModule['ensureRendition']>(),
  }
}
