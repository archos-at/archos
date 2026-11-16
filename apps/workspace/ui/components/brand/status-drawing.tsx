import type { CSSProperties, JSX } from 'react'

import { cn } from '@/lib/utils'

export type StatusDrawingKind = 'missing' | 'closed' | 'fault'

const W = 960
const H = 800
const MODULE = 40

const MODULE_LINES = [
  ...Array.from({ length: W / MODULE - 1 }, (_, i) => `M${(i + 1) * MODULE} 0V${H}`),
  ...Array.from({ length: H / MODULE - 1 }, (_, i) => `M0 ${(i + 1) * MODULE}H${W}`),
].join('')

const tick = (x: number, y: number): string => `M${x - 8} ${y + 8}L${x + 8} ${y - 8}`

const SAG = (Math.atan(40 / 540) * 180) / Math.PI
const PROP_TOP = 180 + 380 * Math.tan((SAG * Math.PI) / 180)

function part(vars: Record<string, string | number>): CSSProperties {
  return vars as CSSProperties
}

function Mask({ id, children }: { id: string; children: JSX.Element | JSX.Element[] }): JSX.Element {
  return (
    <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H} style={{ maskType: 'alpha' }}>
      {children}
    </mask>
  )
}

function Stroke({ d, width, step, quick = false }: { d: string; width: number; step: number; quick?: boolean }): JSX.Element {
  return (
    <path
      className={cn('draw-mask', quick && 'is-quick')}
      pathLength={1}
      strokeWidth={width}
      d={d}
      style={part({ '--step': step })}
    />
  )
}

function PlanDrawing({ kind, id }: { kind: 'missing' | 'closed'; id: string }): JSX.Element {
  const open = kind === 'missing'
  const walk = open ? 'M280 680V400H640' : 'M280 680V400H364'
  const arrow = open ? 'M624 392L640 400L624 408' : 'M348 392L364 400L348 408'
  return (
    <>
      <defs>
        <Mask id={`${id}-walls`}>
          {/* Both walls grow from the entrance: dashes restart at every subpath, so one path each. */}
          <Stroke d="M240 590H170V210H470V360" width={44} step={0} />
          <Stroke d="M320 590H470V440" width={44} step={0} quick />
        </Mask>
        <Mask id={`${id}-swing`}>
          <Stroke d={open ? 'M460 440A80 80 0 0 1 380 360' : 'M380 360A80 80 0 0 0 460 440'} width={14} step={2} />
        </Mask>
        <Mask id={`${id}-walk`}>
          <Stroke d={walk} width={28} step={5} />
        </Mask>
      </defs>

      {/* The dimension chain over the plan: the room that is there, and the one beyond. */}
      <g className="fade" style={part({ '--step': 1 })}>
        <path className="pen-dim" d={`M160 140H800M160 128V188M480 128V188M800 128V188${tick(160, 140)}${tick(480, 140)}${tick(800, 140)}`} />
      </g>
      {/* The room beyond the door, seen only as hidden lines: never built, or not yours to see. */}
      <g className="fade" style={part({ '--step': 4 })}>
        <path className="pen-hidden" d="M480 200H800V600H480M480 220H780V580H480" />
      </g>
      {/* The room you are in: walls cut and hatched, a window to the north, the entrance to the south. */}
      <g mask={`url(#${id}-walls)`}>
        <path className="pen-cut body-hatch" d="M240 600H160V200H240V220H180V580H240Z" />
        <path className="pen-cut body-hatch" d="M400 200H480V360H460V220H400Z" />
        <path className="pen-cut body-hatch" d="M480 440V600H320V580H460V440Z" />
        <rect className="pen-view" x="240" y="200" width="160" height="20" />
        <line className="pen-view" x1="240" y1="210" x2="400" y2="210" />
      </g>
      {/* The door: its swing, and the leaf turning about its hinge (open, or swinging shut). */}
      <g mask={`url(#${id}-swing)`}>
        <path className="pen-view" d="M380 360A80 80 0 0 0 460 440" />
      </g>
      <g
        className={cn('leaf', open && 'is-open')}
        style={part(
          open
            ? { '--hinge': '460px 360px', '--step': 2 }
            : { '--hinge': '460px 360px', '--step': 2, '--swing-from': '0deg', transform: 'rotate(-90deg)' },
        )}
      >
        <g>
          <rect className="body-paper pen-cut" x="380" y="357" width="80" height="6" />
        </g>
      </g>
      {/* The walk line: from outside, through the entrance, to the door and, if it opens, beyond. */}
      <g mask={`url(#${id}-walk)`}>
        <circle className="body-solid" cx="280" cy="680" r="7" />
        <path className="pen-view" d={`${walk}${arrow}`} />
      </g>
    </>
  )
}

function FaultDrawing({ id }: { id: string }): JSX.Element {
  return (
    <>
      <defs>
        <Mask id={`${id}-frame`}>
          <Stroke d="M120 620H840" width={84} step={0} />
          <Stroke d="M240 600V180" width={44} step={1} />
        </Mask>
        <Mask id={`${id}-beam`}>
          <Stroke d="M216 160H764" width={64} step={3} />
        </Mask>
        <Mask id={`${id}-prop`}>
          <Stroke d={`M600 600V${(PROP_TOP - 4).toFixed(1)}`} width={56} step={7} quick />
        </Mask>
      </defs>

      {/* The level the beam should keep: an axis. */}
      <g className="fade" style={part({ '--step': 1 })}>
        <path className="pen-axis" d="M120 180H880" />
      </g>
      {/* The column at the far end is not there: hidden lines. */}
      <g className="fade" style={part({ '--step': 4 })}>
        <rect className="pen-hidden" x="700" y="180" width="40" height="420" />
      </g>
      {/* Ground, cut, and the column that stands. */}
      <g mask={`url(#${id}-frame)`}>
        <rect className="body-hatch" x="120" y="600" width="720" height="40" />
        <path className="pen-cut" d="M120 600H840" />
        <rect className="pen-cut body-hatch" x="220" y="180" width="40" height="420" />
      </g>
      {/* The beam: drawn level, then it sags about its support until the prop holds it. */}
      <g className="sag" style={part({ '--hinge': '220px 180px', '--sag': `${SAG.toFixed(2)}deg`, '--step': 6 })}>
        <g mask={`url(#${id}-beam)`}>
          <rect className="pen-cut body-hatch" x="220" y="140" width="540" height="40" />
        </g>
      </g>
      {/* The temporary prop: base plate, outer and inner tube, head plate. */}
      <g mask={`url(#${id}-prop)`}>
        <rect className="body-solid" x="576" y="592" width="48" height="8" />
        <rect className="body-solid" x="593" y="404" width="14" height="188" />
        <rect className="body-solid" x="597" y={(PROP_TOP + 6).toFixed(1)} width="6" height={(404 - PROP_TOP - 6).toFixed(1)} />
        <rect className="body-solid" x="580" y={PROP_TOP.toFixed(1)} width="40" height="6" />
      </g>
      {/* How far it sagged: a dimension at the free end. */}
      <g className="fade" style={part({ '--step': 9 })}>
        <path className="pen-dim" d={`M848 180V220M772 220H860${tick(848, 180)}${tick(848, 220)}`} />
      </g>
    </>
  )
}

export function StatusDrawing({ kind, className }: { kind: StatusDrawingKind; className?: string }): JSX.Element {
  const id = `status-${kind}`
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={cn('status-drawing', className)}
      viewBox={`0 0 ${W} ${H}`}
      style={part({ '--hatch': `url(#${id}-hatch)` })}
      aria-hidden="true"
      focusable="false"
      data-testid="status-drawing"
    >
      <defs>
        <pattern id={`${id}-hatch`} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line className="pen-hatch" x1="0" y1="0" x2="0" y2="10" />
        </pattern>
      </defs>
      <rect className="sheet-ground" width={W} height={H} />
      <path className="sheet-module" d={MODULE_LINES} />
      {kind === 'fault' ? <FaultDrawing id={id} /> : <PlanDrawing kind={kind} id={id} />}
    </svg>
  )
}
