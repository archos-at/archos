import type { ContributionCullOptions, RenderOptions } from '@ifc-lite/renderer'

const CULL_AT_REST_PX = 1
const CULL_WHILE_MOVING_PX = 3

const LOD_BELOW_PX = 12

export const CONTRIBUTION_CULL: ContributionCullOptions = {
  pixelRadius: CULL_AT_REST_PX,
  interactingPixelRadius: CULL_WHILE_MOVING_PX,
}

export function interactiveFrameOptions(): Pick<RenderOptions, 'contributionCull' | 'lod'> {
  return {
    contributionCull: CONTRIBUTION_CULL,
    lod: { screenPx: LOD_BELOW_PX },
  }
}

export function captureFrameOptions(): Pick<
  RenderOptions,
  'contributionCull' | 'lod' | 'restoreEvictedForCapture' | 'isInteracting' | 'isStreaming'
> {
  return {
    contributionCull: undefined,
    lod: undefined,
    restoreEvictedForCapture: true,
    isInteracting: false,
    isStreaming: false,
  }
}

export function screenshotFilename(modelFilename: string | null, when: Date): string {
  const base = (modelFilename ?? 'modell')
    .replace(/\.(ifc|ifczip|zip)$/i, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  const stamp = [
    when.getFullYear(),
    String(when.getMonth() + 1).padStart(2, '0'),
    String(when.getDate()).padStart(2, '0'),
    '-',
    String(when.getHours()).padStart(2, '0'),
    String(when.getMinutes()).padStart(2, '0'),
    String(when.getSeconds()).padStart(2, '0'),
  ].join('')
  return `${base || 'modell'}-${stamp}.png`
}
