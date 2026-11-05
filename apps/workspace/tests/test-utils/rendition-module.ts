/**
 * The rendition module for a spec that turns office conversion on or off.
 *
 * `isRenditionEnabled` is the switch a spec flips. `isRenditionEnabledFor`,
 * which the dispatch and the delivery ask, keeps its real rule OVER that switch:
 * a DXF always has its converter (the backend, ADR-0152), an office file only
 * when Gotenberg is configured. Mocking the switch alone left the real
 * `isRenditionEnabledFor` reading the real, unmocked switch, and four specs had
 * each written the mock by hand.
 *
 *     vi.mock('@/lib/documents/rendition', async (importOriginal) => {
 *       const { renditionModuleMock } = await import('@/test-utils/rendition-module')
 *       return renditionModuleMock(await importOriginal(), true)
 *     })
 */

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
