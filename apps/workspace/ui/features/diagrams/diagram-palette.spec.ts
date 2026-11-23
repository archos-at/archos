import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { diagramThemeVariables, resetDiagramPaletteCache } from './diagram-palette'

const LIGHT = {
  '--card': '#fafaf9',
  '--foreground': '#0f0e0d',
  '--muted-foreground': '#5e5b57',
  '--muted': '#f2f1f0',
  '--accent': '#ececea',
}
const DARK = {
  '--card': '#1a1918',
  '--foreground': '#f5f4f2',
  '--muted-foreground': '#a6a39e',
  '--muted': '#2c2a27',
  '--accent': '#34312e',
}

function stubCanvas(): void {
  let fill = '#000000'
  const context = {
    get fillStyle(): string {
      return fill
    },
    set fillStyle(value: string) {
      if (/^#[0-9a-f]{6}$/i.test(value)) fill = value.toLowerCase()
    },
    clearRect: () => undefined,
    fillRect: () => undefined,
    getImageData: () => ({
      data: new Uint8ClampedArray([
        Number.parseInt(fill.slice(1, 3), 16),
        Number.parseInt(fill.slice(3, 5), 16),
        Number.parseInt(fill.slice(5, 7), 16),
        255,
      ]),
    }),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  )
}

function stubTokens(): void {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(
    () =>
      ({
        getPropertyValue: (name: string) =>
          (document.documentElement.classList.contains('dark') ? DARK : LIGHT)[
            name as keyof typeof LIGHT
          ] ?? '',
      }) as unknown as CSSStyleDeclaration,
  )
}

beforeEach(() => {
  resetDiagramPaletteCache()
  document.documentElement.className = ''
})

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.className = ''
})

describe('the palette is the product’s, not mermaid’s', () => {
  it('paints text and lines from the ink ramp', () => {
    stubCanvas()
    stubTokens()
    const variables = diagramThemeVariables('light')
    expect(variables?.primaryTextColor).toBe(LIGHT['--foreground'])
    expect(variables?.nodeTextColor).toBe(LIGHT['--foreground'])
    expect(variables?.lineColor).toBe(LIGHT['--muted-foreground'])
    expect(variables?.nodeBorder).toBe(LIGHT['--muted-foreground'])
    expect(variables?.mainBkg).toBe(LIGHT['--muted'])
  })

  it('names no colour outside the monochrome it was given', () => {
    stubCanvas()
    stubTokens()
    const values = Object.values(diagramThemeVariables('light') ?? {}).filter(
      (value): value is string => typeof value === 'string' && value.startsWith('#'),
    )
    expect(values.length).toBeGreaterThan(10)
    for (const hex of values) {
      const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16))
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(12)
    }
  })

  it('keeps every label at AA against the ground it is drawn on, in both themes', () => {
    stubCanvas()
    stubTokens()
    const channel = (c: number): number => {
      const v = c / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    const luminance = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((at) => channel(Number.parseInt(hex.slice(at, at + 2), 16)))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const ratio = (a: string, b: string): number => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }

    for (const theme of ['light', 'dark'] as const) {
      if (theme === 'dark') document.documentElement.classList.add('dark')
      const v = diagramThemeVariables(theme)
      if (!v) throw new Error('palette unavailable')
      expect(ratio(v.nodeTextColor as string, v.mainBkg as string)).toBeGreaterThanOrEqual(4.5)
      expect(ratio(v.textColor as string, v.clusterBkg as string)).toBeGreaterThanOrEqual(4.5)
      expect(ratio(v.lineColor as string, v.background as string)).toBeGreaterThanOrEqual(3)
      document.documentElement.className = ''
      resetDiagramPaletteCache()
    }
  })

  it('reads the paper palette while the reader is in dark mode, and puts the class back', () => {
    stubCanvas()
    stubTokens()
    document.documentElement.classList.add('dark')
    const paper = diagramThemeVariables('light')
    expect(paper?.background).toBe(LIGHT['--card'])
    expect(paper?.primaryTextColor).toBe(LIGHT['--foreground'])
    expect(paper?.darkMode).toBe(false)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('reads the charcoal palette for the screen', () => {
    stubCanvas()
    stubTokens()
    const screen = diagramThemeVariables('dark')
    expect(screen?.primaryTextColor).toBe(DARK['--foreground'])
    expect(screen?.darkMode).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('gives the xychart its whole theme, because a partial one replaces the derived colours', () => {
    stubCanvas()
    stubTokens()
    for (const [theme, tokens] of [
      ['light', LIGHT],
      ['dark', DARK],
    ] as const) {
      const chart = diagramThemeVariables(theme)?.xyChart
      expect(chart).toMatchObject({
        backgroundColor: tokens['--card'],
        titleColor: tokens['--foreground'],
        xAxisLabelColor: tokens['--foreground'],
        yAxisLineColor: tokens['--foreground'],
      })
      expect(typeof chart === 'object' && chart.plotColorPalette).not.toMatch(/FFF4DD/i)
    }
  })

  it('sets the diagram’s type on the body ramp rather than mermaid’s 16px', () => {
    stubCanvas()
    stubTokens()
    expect(diagramThemeVariables('light')?.fontSize).toBe('14px')
  })
})

describe('when the design system is not there', () => {
  it('answers null rather than a palette of written-down hexes', () => {
    stubCanvas()
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () => ({ getPropertyValue: () => '' }) as unknown as CSSStyleDeclaration,
    )
    expect(diagramThemeVariables('light')).toBeNull()
  })
})
