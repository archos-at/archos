// @disk-inputs: ui/features/bim/components/**, ui/features/bim/hooks/use-ifc-viewer-input.ts
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { blankComments } from '../../../scripts/check-static-utility-modifiers.mjs'

const COMPONENTS = join(__dirname, 'components')

const code = (...segments: string[]): string =>
  blankComments(readFileSync(join(COMPONENTS, ...segments), 'utf8')) as string

const canvasCode = (): string =>
  ['ifc-viewer-canvas.tsx', 'ifc-viewer-canvas-view.tsx', 'use-ifc-viewer-canvas-controller.tsx', join('..', 'hooks', 'use-ifc-viewer-input.ts')]
    .map((file) => code(file))
    .join('\n');

const sources = (dir = COMPONENTS): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx$/.test(entry.name) && !/\.spec\.tsx$/.test(entry.name) ? [path] : []
  })

const stageCode = (): string =>
  ['model-stage.tsx', 'model-stage-view.tsx', 'model-stage-layers.tsx', 'model-stage-dock-layer.tsx', 'use-model-stage-controller.tsx']
    .map((file) => code(file))
    .join('\n');

describe('the stage respects the notch at every width', () => {
  it('pads the dialog by the safe-area insets without a breakpoint prefix', () => {
    const stage = stageCode()
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(stage).toContain(`env(safe-area-inset-${side})`)
      expect(stage).not.toContain(`max-sm:p${side[0]}-[env(safe-area-inset-${side})]`)
    }
  })
})

describe('a hover is never the only way to read a value', () => {
  it('no truncated value hides its full text in a title attribute', () => {
    const offenders: string[] = []
    for (const file of sources()) {
      const source = blankComments(readFileSync(file, 'utf8')) as string
      for (const match of source.matchAll(/<(?:dd|span|p|h\d|div)\b[^>]*>/g)) {
        const tag = match[0]
        if (!/\btruncate\b/.test(tag) || !/\btitle=/.test(tag)) continue
        if (/pointer-coarse:(?:line-clamp|whitespace-normal)/.test(tag)) continue
        offenders.push(
          `${file.slice(COMPONENTS.length + 1)}: ${tag.replace(/\s+/g, ' ').slice(0, 100)}`
        )
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('an inline link in the compliance panel is a touch target', () => {
  it('every underlined link carries the 44 px treatment', () => {
    const panel = code('ifc-compliance-panel.tsx')
    const underlined = [...panel.matchAll(/['"`][^'"`]*underline underline-offset-2[^'"`]*['"`]/g)]
    expect(underlined.length).toBeGreaterThanOrEqual(3)
    for (const match of underlined) {
      expect(match[0], match[0]).toContain('${TOUCH_LINK}')
    }
    expect(panel).toMatch(/TOUCH_LINK =\s*'[^']*pointer-coarse:min-h-11/)
  })

  it('the model health "show elements" button reaches the floor too', () => {
    expect(code('ifc-model-explorer.tsx')).toMatch(/pointer-coarse:min-h-11"/)
  })
})

describe('only a surface that owns its gesture keeps the touch action', () => {
  it('limits touch-none to the canvas and the sheet handle', () => {
    const allowed = new Set(['ifc-viewer-canvas-view.tsx', join('viewer', 'viewer-sheet.tsx')])
    const offenders = sources()
      .filter((file) => /\btouch-none\b/.test(blankComments(readFileSync(file, 'utf8')) as string))
      .map((file) => file.slice(COMPONENTS.length + 1))
      .filter((file) => !allowed.has(file))
    expect(offenders).toEqual([])
  })
})

describe('the canvas tells a tap from a drag by what is pressing', () => {
  it('uses the per-pointer slop, not a constant two pixels', () => {
    const canvas = canvasCode()
    expect(canvas).toContain('dragSlopFor(')
    expect(canvas).not.toContain('DRAG_SLOP_PX')
  })

  it('recognises a double-tap itself rather than waiting for a dblclick iOS may not send', () => {
    const canvas = canvasCode()
    expect(canvas).toContain('isDoubleTap(')
  })
})

describe('the phone dock fits', () => {
  it('never scrolls sideways: the phone layouts have no overflow row', () => {
    const dock = code('viewer', 'viewer-dock.tsx')
    const phoneBranch = dock.slice(
      dock.indexOf("layout !== 'floating'"),
      dock.indexOf('overflow-x-auto')
    )
    expect(phoneBranch).toContain('viewer-dock-bar')
    expect(phoneBranch).not.toContain('overflow-x-auto')
  })
})
