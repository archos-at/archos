import type { DiagramTheme } from './render-diagram'

export type DiagramThemeVariables = Record<string, string | boolean | Record<string, string>>

const ROLE_TOKENS = {
  surface: '--card',
  ink: '--foreground',
  line: '--muted-foreground',
  fill: '--muted',
  inset: '--accent',
} as const

type Role = keyof typeof ROLE_TOKENS

const SENTINELS = ['#010203', '#040506'] as const

function assignFill(context: CanvasRenderingContext2D, value: string): boolean {
  for (const sentinel of SENTINELS) {
    context.fillStyle = sentinel
    context.fillStyle = value
    if (context.fillStyle !== sentinel) return true
  }
  return false
}

function toHex(context: CanvasRenderingContext2D, value: string, over: string | null): string | null {
  context.clearRect(0, 0, 1, 1)
  if (over) {
    if (!assignFill(context, over)) return null
    context.fillRect(0, 0, 1, 1)
  }
  if (!assignFill(context, value)) return null
  context.fillRect(0, 0, 1, 1)
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

function readRoles(theme: DiagramTheme): Record<Role, string> | null {
  const root = document.documentElement
  const wasDark = root.classList.contains('dark')
  const swap = wasDark !== (theme === 'dark')
  if (swap) root.classList.toggle('dark', theme === 'dark')
  try {
    const computed = window.getComputedStyle(root)
    const raw: Partial<Record<Role, string>> = {}
    for (const [role, token] of Object.entries(ROLE_TOKENS) as [Role, string][]) {
      const value = computed.getPropertyValue(token).trim()
      if (!value) return null
      raw[role] = value
    }
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    const surface = toHex(context, raw.surface ?? '', null)
    if (!surface) return null
    const resolved: Partial<Record<Role, string>> = { surface }
    for (const role of Object.keys(ROLE_TOKENS) as Role[]) {
      if (role === 'surface') continue
      const hex = toHex(context, raw[role] ?? '', surface)
      if (!hex) return null
      resolved[role] = hex
    }
    return resolved as Record<Role, string>
  } finally {
    if (swap) root.classList.toggle('dark', wasDark)
  }
}

const cache = new Map<DiagramTheme, DiagramThemeVariables | null>()

export function diagramThemeVariables(theme: DiagramTheme): DiagramThemeVariables | null {
  const cached = cache.get(theme)
  if (cached !== undefined) return cached
  const built = build(theme)
  cache.set(theme, built)
  return built
}

export function resetDiagramPaletteCache(): void {
  cache.clear()
}

function build(theme: DiagramTheme): DiagramThemeVariables | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null
  let roles: Record<Role, string> | null = null
  try {
    roles = readRoles(theme)
  } catch {
    roles = null
  }
  if (!roles) return null
  const { surface, ink, line, fill, inset } = roles

  return {
    darkMode: theme === 'dark',
    background: surface,
    fontSize: '14px',

    primaryColor: fill,
    primaryBorderColor: line,
    primaryTextColor: ink,
    secondaryColor: inset,
    secondaryBorderColor: line,
    secondaryTextColor: ink,
    tertiaryColor: inset,
    tertiaryBorderColor: line,
    tertiaryTextColor: ink,
    mainBkg: fill,
    nodeBorder: line,
    nodeTextColor: ink,
    lineColor: line,
    textColor: ink,
    titleColor: ink,
    edgeLabelBackground: surface,
    clusterBkg: inset,
    clusterBorder: line,
    defaultLinkColor: line,
    arrowheadColor: line,

    actorBkg: fill,
    actorBorder: line,
    actorTextColor: ink,
    actorLineColor: line,
    signalColor: line,
    signalTextColor: ink,
    labelBoxBkgColor: fill,
    labelBoxBorderColor: line,
    labelTextColor: ink,
    loopTextColor: ink,
    activationBkgColor: inset,
    activationBorderColor: line,
    sequenceNumberColor: surface,
    noteBkgColor: inset,
    noteBorderColor: line,
    noteTextColor: ink,
    altBackground: inset,

    stateBkg: fill,
    stateLabelColor: ink,
    compositeBackground: inset,
    compositeTitleBackground: inset,
    transitionColor: line,
    transitionLabelColor: ink,
    specialStateColor: line,
    innerEndBackground: line,

    sectionBkgColor: inset,
    sectionBkgColor2: inset,
    altSectionBkgColor: surface,
    taskBkgColor: fill,
    taskBorderColor: line,
    taskTextColor: ink,
    taskTextLightColor: ink,
    taskTextDarkColor: ink,
    taskTextOutsideColor: ink,
    taskTextClickableColor: ink,
    activeTaskBkgColor: inset,
    activeTaskBorderColor: line,
    doneTaskBkgColor: inset,
    doneTaskBorderColor: line,
    critBkgColor: fill,
    critBorderColor: line,
    excludeBkgColor: surface,
    gridColor: line,
    todayLineColor: line,

    ...Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [
        [`cScale${index}`, index % 2 === 0 ? fill : inset],
        [`cScaleLabel${index}`, ink],
      ]).flat(),
    ),

    git0: inset,
    gitBranchLabel0: ink,

    ...Object.fromEntries(PIE_STEPS.map((share, index) => [`pie${index + 1}`, mixHex(ink, surface, share)])),
    pieStrokeColor: surface,
    pieOuterStrokeColor: line,
    pieTitleTextColor: ink,
    pieSectionTextColor: ink,
    pieLegendTextColor: ink,

    xyChart: {
      backgroundColor: surface,
      titleColor: ink,
      legendTextColor: ink,
      xAxisTitleColor: ink,
      xAxisLabelColor: ink,
      xAxisTickColor: ink,
      xAxisLineColor: ink,
      yAxisTitleColor: ink,
      yAxisLabelColor: ink,
      yAxisTickColor: ink,
      yAxisLineColor: ink,
      plotColorPalette: [mixHex(ink, surface, 0.45), ink, mixHex(ink, surface, 0.7)].join(','),
    },
  }
}

const PIE_STEPS = [0.1, 0.22, 0.34, 0.16, 0.28, 0.4] as const

function mixHex(a: string, b: string, share: number): string {
  const channels = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16))
  const [from, to] = [channels(a), channels(b)]
  return `#${from
    .map((value, index) => Math.round(value * share + to[index] * (1 - share)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`
}
