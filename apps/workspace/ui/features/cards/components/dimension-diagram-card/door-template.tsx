import type { Translator } from '@/i18n'
import type { DimensionCheckData } from '@/shared/cards/schemas'
import { DimensionArrow, ExtensionLine, fitScale } from '../../schematics/kit'
import { sketchPath, sketchRect, type Point } from '../../schematics/rough'
import { label, pick } from '../../lib/diagram-dimensions'
import type { Template } from './template'

export const doorTemplate = (dims: DimensionCheckData[], t: Translator): Template => {
  const widthDim = pick(dims, ['breite', 'durchgang', 'width'])
  const heightDim = pick(dims, ['höhe', 'hoehe', 'height'])
  const w = widthDim?.value ?? 90
  const h = heightDim?.value ?? 210
  const k = fitScale(w, h, 185, 170)
  const f = 9 // frame thickness (visual)
  const ox = 56
  const oy = 20
  const W = w * k
  const H = h * k
  const floorY = oy + H

  const frameOuter: Point[] = [
    [ox - f, floorY],
    [ox - f, oy - f],
    [ox + W + f, oy - f],
    [ox + W + f, floorY],
  ]
  const frameInner: Point[] = [
    [ox, floorY],
    [ox, oy],
    [ox + W, oy],
    [ox + W, floorY],
  ]

  return {
    viewW: ox + W + f + 62,
    viewH: floorY + 38,
    node: (
      <g>
        {/* floor line */}
        <line
          x1={ox - f - 26}
          y1={floorY}
          x2={ox + W + f + 48}
          y2={floorY}
          stroke="var(--foreground)"
          strokeWidth={1.4}
        />
        {/* frame (Stock) and clear opening */}
        {sketchPath(frameOuter, 'door-frame-outer', { strokeWidth: 1.4 })}
        {sketchPath(frameInner, 'door-frame-inner', { strokeWidth: 1.1 })}
        {/* leaf + handle */}
        {sketchRect(ox + 3, oy + 3, W - 6, H - 3, 'door-leaf', {
          strokeWidth: 1,
          stroke: 'var(--muted-foreground)',
        })}
        <circle
          cx={ox + W - 11}
          cy={oy + H * 0.52}
          r={2.4}
          fill="var(--muted-foreground)"
          opacity={0.85}
        />
        {/* lichte Durchgangsbreite — between the jambs, at the floor */}
        {widthDim && (
          <g>
            <ExtensionLine x1={ox} y1={floorY} x2={ox} y2={floorY + 20} />
            <ExtensionLine x1={ox + W} y1={floorY} x2={ox + W} y2={floorY + 20} />
            <DimensionArrow
              x1={ox}
              y1={floorY + 16}
              x2={ox + W}
              y2={floorY + 16}
              label={label(widthDim, t)}
              status={widthDim.status}
              labelOffset={9}
              fontSize={9.5}
            />
          </g>
        )}
        {/* Durchgangshöhe — floor to opening top */}
        {heightDim && (
          <g>
            <ExtensionLine x1={ox + W + f} y1={oy} x2={ox + W + f + 20} y2={oy} />
            <DimensionArrow
              x1={ox + W + f + 16}
              y1={floorY}
              x2={ox + W + f + 16}
              y2={oy}
              label={label(heightDim, t)}
              status={heightDim.status}
              labelOffset={13}
              fontSize={9.5}
            />
          </g>
        )}
      </g>
    ),
  }
}
