import type { Translator } from '@/i18n'
import type { DimensionCheckData } from '@/shared/cards/schemas'
import { DimensionArrow, ExtensionLine, fitScale } from '../../schematics/kit'
import { sketchLine, sketchPath, sketchRect } from '../../schematics/rough'
import { label, pick } from '../../lib/diagram-dimensions'
import type { Template } from './template'

export const liftCabinTemplate = (dims: DimensionCheckData[], t: Translator): Template => {
  const doorDim = pick(dims, ['tür', 'tuer', 'door'])
  const rest = dims.filter((d) => d !== doorDim)
  const widthDim = pick(rest, ['breite', 'width'])
  const depthDim = pick(rest.filter((d) => d !== widthDim), ['tiefe', 'länge', 'laenge', 'depth', 'length'])
  const w = widthDim?.value ?? 110
  const d = depthDim?.value ?? 140
  const door = Math.min(doorDim?.value ?? 90, w)
  const k = fitScale(w, d, 200, 190)
  const x0 = 34
  const y0 = 30
  const W = w * k
  const D = d * k
  const doorW = door * k
  const doorX = x0 + (W - doorW) / 2
  const wall = 6

  return {
    viewW: x0 + W + 64,
    viewH: y0 + D + 44,
    node: (
      <g>
        {/* The shaft wall around the cabin, the cabin itself, the door gap in front. */}
        {sketchRect(x0 - wall, y0 - wall, W + 2 * wall, D + 2 * wall, 'lift-shaft', { strokeWidth: 1 })}
        {sketchRect(x0, y0, W, D, 'lift-cabin', { strokeWidth: 1.5 })}
        {sketchPath(
          [
            [doorX, y0 + D],
            [doorX + doorW, y0 + D],
          ],
          'lift-door',
          { stroke: 'var(--card)', strokeWidth: 4 }
        )}
        {sketchLine(doorX, y0 + D + wall, doorX + doorW, y0 + D + wall, 'lift-door-line', {
          strokeWidth: 1,
          strokeLineDash: [3, 3],
        })}
        {widthDim && (
          <DimensionArrow
            x1={x0}
            y1={y0 - 16}
            x2={x0 + W}
            y2={y0 - 16}
            label={label(widthDim, t)}
            status={widthDim.status}
            labelOffset={-7}
            fontSize={9.5}
          />
        )}
        {depthDim && (
          <g>
            <ExtensionLine x1={x0 + W} y1={y0} x2={x0 + W + 26} y2={y0} />
            <ExtensionLine x1={x0 + W} y1={y0 + D} x2={x0 + W + 26} y2={y0 + D} />
            <DimensionArrow
              x1={x0 + W + 22}
              y1={y0}
              x2={x0 + W + 22}
              y2={y0 + D}
              label={label(depthDim, t)}
              status={depthDim.status}
              labelOffset={13}
              fontSize={9.5}
            />
          </g>
        )}
        {doorDim && (
          <DimensionArrow
            x1={doorX}
            y1={y0 + D + 24}
            x2={doorX + doorW}
            y2={y0 + D + 24}
            label={label(doorDim, t)}
            status={doorDim.status}
            labelOffset={11}
            fontSize={9.5}
          />
        )}
      </g>
    ),
  }
}
