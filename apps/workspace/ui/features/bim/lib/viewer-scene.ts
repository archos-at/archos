import type { LightingEnvironment, VisualEnhancementOptions } from '@ifc-lite/renderer'

export type ViewerTheme = 'light' | 'dark'

export const VIEWER_CLEAR_COLOR: Record<ViewerTheme, [number, number, number, number]> = {
  light: [0.949, 0.945, 0.937, 1],
  dark: [0.086, 0.086, 0.09, 1],
}

const SKY: Record<ViewerTheme, { zenith: [number, number, number]; horizon: [number, number, number]; ground: [number, number, number] }> = {
  light: {
    zenith: [0.965, 0.961, 0.949],
    horizon: [0.925, 0.919, 0.906],
    ground: [0.855, 0.847, 0.831],
  },
  dark: {
    zenith: [0.075, 0.075, 0.082],
    horizon: [0.125, 0.126, 0.133],
    ground: [0.055, 0.055, 0.06],
  },
}

const SUN_DIRECTION: [number, number, number] = [-0.42, 0.82, 0.39]

export function viewerEnvironment(theme: ViewerTheme): LightingEnvironment {
  const dark = theme === 'dark'
  return {
    sunDirection: SUN_DIRECTION,
    sunColor: dark ? [0.92, 0.93, 1] : [1, 0.985, 0.955],
    sunIntensity: dark ? 0.5 : 0.62,
    skyColor: dark ? [0.24, 0.26, 0.32] : [0.62, 0.65, 0.72],
    groundColor: dark ? [0.1, 0.095, 0.09] : [0.36, 0.33, 0.3],
    ambientIntensity: dark ? 0.42 : 0.38,
    fillIntensity: dark ? 0.2 : 0.16,
    rimIntensity: dark ? 0.26 : 0.14,
    exposure: dark ? 0.92 : 0.88,
    skyEnabled: true,
    sky: SKY[theme],
  }
}

export function viewerEnhancement(): VisualEnhancementOptions {
  return {
    enabled: true,
    edgeContrast: { enabled: true, intensity: 0.55 },
    contactShading: { quality: 'high', intensity: 0.7, radius: 0.6 },
    separationLines: { enabled: true, quality: 'high', intensity: 0.45, radius: 0.5 },
  }
}

export function viewerEnhancementCompact(): VisualEnhancementOptions {
  return {
    enabled: true,
    edgeContrast: { enabled: true, intensity: 0.5 },
    contactShading: { quality: 'low', intensity: 0.55, radius: 0.6 },
    separationLines: { enabled: false },
  }
}

export function readViewerTheme(): ViewerTheme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

export function observeViewerTheme(onChange: (theme: ViewerTheme) => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => {}
  }
  let current = readViewerTheme()
  const observer = new MutationObserver(() => {
    const next = readViewerTheme()
    if (next === current) return
    current = next
    onChange(next)
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}
