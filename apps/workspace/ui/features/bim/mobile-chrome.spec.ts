// @disk-inputs: app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ComponentProps } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Home } from 'lucide-react'
import { exportedNames, lineOf, nodesOf, parseSource, productionSources, ts, walk } from '@/test-utils/source-ast'
import { ModelStage } from './components/model-stage'
import { IfcViewerCanvas } from './components/ifc-viewer-canvas'
import { IfcCompliancePanel } from './components/ifc-compliance-panel'
import { IfcModelHealthPanel } from './components/ifc-model-explorer'
import { ViewerDock } from './components/viewer/viewer-dock'
import { ViewerIconButton } from './components/viewer/viewer-icon-button'
import { model, routerReplace, setWebGpu, sourceReload, modelsReload, state } from './components/model-stage.fixtures'
import type { BimRuleResult, BimRuleResultWithConfirmation } from '@/lib/bim/rules'
import type { BimViewerElement } from './lib/model-index'

const COMPONENTS = 'ui/features/bim/components/'

const componentSources = (): string[] => productionSources().filter((file) => file.startsWith(COMPONENTS))

const classTokens = (node: ts.Node): string[] => {
  const words: string[] = []
  walk(node, (child) => {
    if (
      ts.isStringLiteralLike(child) ||
      ts.isTemplateHead(child) ||
      ts.isTemplateMiddle(child) ||
      ts.isTemplateTail(child)
    ) {
      words.push(...child.text.split(/\s+/))
    }
  })
  return words.filter(Boolean)
}

const exports = (file: string): string[] => exportedNames(parseSource(file))

let searchParams = new URLSearchParams()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: (...args: unknown[]) => routerReplace(...args),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/app/projects/p1/files',
  useSearchParams: () => searchParams,
}))

vi.mock('./components/model-advanced-sheet', () => ({
  ModelAdvancedSheet: ({ open }: { open: boolean }) =>
    open ? createElement('div', { 'data-testid': 'advanced-sheet' }) : null,
}))

vi.mock('./components/model-file-ownership', () => ({
  ModelFileOwnership: () => createElement('div', { 'data-testid': 'stage-file-ownership' }),
}))

let modelsError: string | null = null

vi.mock('./hooks/use-bim-model', () => ({
  useProjectBimModels: () => ({
    data: state.models,
    isLoading: false,
    error: modelsError,
    reload: modelsReload,
  }),
  useDocumentBimModel: () => ({ data: null, isLoading: false, error: null, reload: () => {} }),
  useBimElements: () => ({
    data: state.elementsLoading ? null : state.elements,
    isLoading: state.elementsLoading,
    error: null,
  }),
  useBimElementDetail: () => ({ data: state.detail, isLoading: false, error: null }),
  useBimModelSource: () => ({
    data: state.sourceUrl,
    isLoading: false,
    error: state.sourceError,
    reload: sourceReload,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  searchParams = new URLSearchParams('model=Haus-A.ifc')
  state.models = [model()]
  state.elements = []
  state.elementsLoading = false
  state.detail = null
  state.sourceUrl = 'https://example.test/haus-a.ifc'
  state.sourceError = null
  modelsError = null
  canvas.frames = 0
  canvas.pickHit = null
  canvas.entityBox = null
  stubCanvasHost()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      body: null,
      arrayBuffer: async () => new ArrayBuffer(8),
    }))
  )
  setWebGpu(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  setWebGpu(false)
})

describe('the stage respects the notch at every width', () => {
  it('pads the dialog by the four safe-area insets, without a breakpoint prefix', () => {
    render(createElement(ModelStage, { projectId: 'p1', onClose: vi.fn() }))
    const classes = screen.getByRole('dialog').className.split(/\s+/)

    for (const side of ['top', 'right', 'bottom', 'left']) {
      const padding = classes.filter((cls) => cls.includes(`safe-area-inset-${side}`))
      expect(padding, side).toHaveLength(1)
      expect(padding[0], side).not.toContain(':')
    }
  })
})

describe('a hover is never the only way to read a value', () => {
  const TEXT_TAGS = new Set(['dd', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div'])

  it('no truncated value hides its full text in a title attribute', () => {
    const offenders: string[] = []
    expect(componentSources().length).toBeGreaterThan(0)
    for (const file of componentSources()) {
      const source = parseSource(file)
      const tags = [
        ...nodesOf(source, ts.isJsxOpeningElement),
        ...nodesOf(source, ts.isJsxSelfClosingElement),
      ]
      for (const tag of tags) {
        if (!ts.isIdentifier(tag.tagName) || !TEXT_TAGS.has(tag.tagName.text)) continue
        const words = classTokens(tag.attributes)
        const hasTitle = tag.attributes.properties.some(
          (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'title'
        )
        const truncated = words.some((word) => /(^|:)truncate$/.test(word))
        const wrapsOnPointer = words.some(
          (word) => word.startsWith('pointer-coarse:line-clamp') || word.startsWith('pointer-coarse:whitespace-normal')
        )
        if (hasTitle && truncated && !wrapsOnPointer) offenders.push(`${file}:${lineOf(tag)}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

const RULE_BASE: BimRuleResultWithConfirmation = {
  ruleId: 'oib4-door-clear-width',
  confirmation: null,
  confirmationStale: false,
  richtlinie: 'OIB 4',
  clause: '3',
  titleDe: 'Türen — lichte Durchgangsbreite',
  thresholdDe: 'lichte Durchgangsbreite ≥ 0,80 m',
  applicable: true,
  passed: 12,
  failed: 2,
  undecidable: 0,
  failures: [
    { globalId: 'g-door-1', name: 'T-14', storeyName: 'Erdgeschoss', status: 'fail', reading: 'Breite 0,7 m' },
    { globalId: 'g-door-2', name: 'T-15', storeyName: 'Erdgeschoss', status: 'fail', reading: 'Breite 0,75 m' },
  ],
  unknowns: [],
  truncated: false,
  missing: [],
}

const UNDECIDABLE: BimRuleResultWithConfirmation = {
  ...RULE_BASE,
  ruleId: 'oib2-fire-resistance-load-bearing',
  richtlinie: 'OIB 2',
  failed: 0,
  passed: 0,
  undecidable: 34,
  failures: [],
  unknowns: [
    {
      globalId: 'g-wall-1',
      name: 'AW 38',
      storeyName: 'Erdgeschoss',
      status: 'undecidable',
      reading: 'Kein Feuerwiderstand am Bauteil hinterlegt',
    },
  ],
  missing: [{ path: 'Pset_WallCommon.FireRating', elements: 34 }],
}

const STOOD_DOWN: BimRuleResult & BimRuleResultWithConfirmation = {
  ...RULE_BASE,
  ruleId: 'oib6-u-value-window',
  richtlinie: 'OIB 6',
  applicable: false,
  notApplicableReason: 'Gebäudeklasse in den Projektangaben nicht gesetzt',
}

const COMPLIANCE_SUMMARY = {
  rulesApplicable: 2,
  rulesNotApplicable: 1,
  rulesFailing: 1,
  rulesUndecidable: 1,
  rulesPassing: 0,
  rulesEmpty: 0,
  elementsFailed: 2,
  elementsUndecidable: 34,
}

const renderCompliance = () =>
  render(
    createElement(IfcCompliancePanel, {
      rules: [RULE_BASE, UNDECIDABLE, STOOD_DOWN],
      summary: COMPLIANCE_SUMMARY,
      shoppingList: [{ path: 'Pset_WallCommon.FireRating', elements: 34, rules: ['oib2-fire-resistance-load-bearing'] }],
      isLoading: false,
      error: null,
      projectId: 'p1',
      modelFilename: 'haus-a.ifc',
      missingFacts: [],
      askHref: '/app/projects/p1/chat?ask=x',
      bcfHref: '/api/projects/p1/bim/checks/export?modelId=m1',
    })
  )

describe('an inline link in the compliance panel is a touch target', () => {
  it('every underlined link carries the 44 px treatment', () => {
    renderCompliance()
    const underlined = Array.from(document.querySelectorAll('.underline-offset-2'))
    expect(underlined.length).toBeGreaterThanOrEqual(3)
    for (const link of underlined) {
      expect(link.className, link.textContent ?? '').toContain('pointer-coarse:min-h-11')
    }
  })

  it('the model health "show elements" button reaches the floor too', () => {
    const health = {
      score: 74,
      totals: { error: 1, warning: 0, info: 0 },
      issues: [
        {
          rule: 'spatial-orphan-elements' as const,
          stage: 'spatial' as const,
          severity: 'error' as const,
          count: 6,
          total: 175,
          sampleGlobalIds: ['g-w4'],
          detail: null,
        },
      ],
    }
    render(createElement(IfcModelHealthPanel, { health, onShowElements: vi.fn() }))
    const buttons = screen.getAllByRole('button', { name: 'Show elements' })
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) expect(button.className).toContain('pointer-coarse:min-h-11')
  })
})

describe('only a surface that owns its gesture keeps the touch action', () => {
  const OWNERS = ['IfcViewerCanvasView', 'ViewerSheet']

  it('limits touch-none to the canvas and the sheet handle', () => {
    expect(componentSources().length).toBeGreaterThan(0)
    const offenders = componentSources().filter((file) => {
      const source = parseSource(file)
      const usesTouchNone = classTokens(source).includes('touch-none')
      return usesTouchNone && !exports(file).some((name) => OWNERS.includes(name))
    })
    expect(offenders).toEqual([])
  })
})

const CANVAS_ELEMENTS: BimViewerElement[] = [
  { globalId: 'g-w1', expressId: 21, ifcType: 'IfcWall', name: 'Aussenwand', storeyName: 'EG' },
]

const BOUNDS = { min: { x: -10, y: -3, z: -10 }, max: { x: 10, y: 9, z: 10 } }

const canvas = {
  frames: 0,
  pickHit: null as { expressId: number } | null,
  entityBox: null as { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null,
}

const camera = {
  orbit: vi.fn(),
  pan: vi.fn(),
  zoom: vi.fn(),
  update: vi.fn(() => false),
  setOrbitCenter: vi.fn(),
  setAspect: vi.fn(),
  zoomExtent: vi.fn(async () => {}),
  frameBounds: vi.fn(async () => {}),
  setPresetView: vi.fn(),
  setProjectionMode: vi.fn(),
  fitBoundsAdaptive: vi.fn(),
  setSceneBounds: vi.fn(),
  projectToScreen: vi.fn((point: { x: number; y: number }) => ({ x: point.x * 10, y: point.y * 10 })),
}

vi.mock('@ifc-lite/renderer', () => ({
  Renderer: class {
    async init(): Promise<void> {}
    addMeshes(): void {}
    async enableQuantizedBatches(): Promise<boolean> {
      return true
    }
    async captureScreenshot(): Promise<string> {
      return 'data:image/png;base64,AAA'
    }
    fitToView(): void {}
    resize(): void {}
    render(): void {
      canvas.frames += 1
    }
    destroy(): void {}
    async pick() {
      return canvas.pickHit
    }
    raycastScene() {
      return null
    }
    getCamera() {
      return camera
    }
    getModelBounds() {
      return BOUNDS
    }
    getScene() {
      return {
        setColorOverrides: vi.fn(),
        clearColorOverrides: vi.fn(),
        getEntityBoundingBox: () => canvas.entityBox,
        setLodBuildsEnabled: () => {},
      }
    }
    getGPUDevice() {
      return {}
    }
    getPipeline() {
      return {}
    }
    onDeviceLost() {
      return () => {}
    }
  },
}))

vi.mock('@ifc-lite/geometry', () => ({
  GeometryProcessor: class {
    async init(): Promise<void> {}
    async *processAdaptive(): AsyncGenerator<{ type: string; meshes: unknown[] }> {
      yield { type: 'batch', meshes: [{}, {}] }
    }
    dispose(): void {}
  },
}))

function stubCanvasHost(): void {
  const element = HTMLCanvasElement.prototype as unknown as Record<string, unknown>
  Object.defineProperty(element, 'clientWidth', { value: 800, configurable: true })
  Object.defineProperty(element, 'clientHeight', { value: 600, configurable: true })
  element.setPointerCapture = () => {}
  element.releasePointerCapture = () => {}
  element.hasPointerCapture = () => false
}

function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  target: Element,
  init: { pointerType: string; clientX: number; clientY: number }
): void {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: 1, button: 0, ...init })
  fireEvent(target, event)
}

async function mountCanvas(): Promise<HTMLCanvasElement> {
  const view = render(
    createElement(IfcViewerCanvas, { sourceUrl: 'https://example.test/model.ifc', elements: CANVAS_ELEMENTS })
  )
  const element = view.container.querySelector('canvas')
  if (!element) throw new Error('the canvas did not mount')
  await waitFor(() => expect(canvas.frames).toBeGreaterThan(0))
  return element
}

describe('the canvas tells a tap from a drag by what is pressing', () => {
  it('moves the camera on a 5 px mouse drag but not on a 5 px touch', async () => {
    const element = await mountCanvas()

    pointer('pointerdown', element, { pointerType: 'touch', clientX: 100, clientY: 100 })
    pointer('pointermove', element, { pointerType: 'touch', clientX: 105, clientY: 100 })
    expect(camera.orbit).not.toHaveBeenCalled()
    pointer('pointerup', element, { pointerType: 'touch', clientX: 105, clientY: 100 })

    pointer('pointerdown', element, { pointerType: 'mouse', clientX: 100, clientY: 100 })
    pointer('pointermove', element, { pointerType: 'mouse', clientX: 105, clientY: 100 })
    expect(camera.orbit).toHaveBeenCalled()
    pointer('pointerup', element, { pointerType: 'mouse', clientX: 105, clientY: 100 })
  })

  it('frames the element on a second touch tap, which the canvas recognises itself', async () => {
    const element = await mountCanvas()
    canvas.pickHit = { expressId: 21 }
    canvas.entityBox = BOUNDS

    pointer('pointerdown', element, { pointerType: 'touch', clientX: 200, clientY: 200 })
    pointer('pointerup', element, { pointerType: 'touch', clientX: 200, clientY: 200 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(camera.frameBounds).not.toHaveBeenCalled()

    pointer('pointerdown', element, { pointerType: 'touch', clientX: 202, clientY: 201 })
    pointer('pointerup', element, { pointerType: 'touch', clientX: 202, clientY: 201 })
    await waitFor(() => expect(camera.frameBounds).toHaveBeenCalled())
  })
})

describe('the phone dock fits', () => {
  const dock = (layout: 'floating' | 'bar') =>
    createElement(
      ViewerDock,
      { layout } as ComponentProps<typeof ViewerDock>,
      createElement(ViewerIconButton, { label: 'Schnitt', icon: Home }),
      createElement(ViewerIconButton, { label: 'Messen', icon: Home })
    )

  it('never scrolls sideways: the phone layouts have no overflow row', () => {
    const { container } = render(dock('bar'))
    expect(container.querySelector('[data-slot="viewer-dock-bar"]')).not.toBeNull()
    expect(container.querySelector('.overflow-x-auto')).toBeNull()
  })

  it('the floating dock is the one that scrolls its row', () => {
    const { container } = render(dock('floating'))
    expect(container.querySelector('.overflow-x-auto')).not.toBeNull()
  })
})
