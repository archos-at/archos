import type { JSX } from 'react'
import type { ReactNode, SVGProps } from 'react'
import { ImageIcon, ImageOff } from 'lucide-react'
import type { DocumentKind } from '../document-kind'
import { cn } from '@/lib/utils'

type SvgProps = Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'children'>

function Frame({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 120 80"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
      {...props}
    >
      {children}
    </svg>
  )
}

function FloorPlanSketch(props: SvgProps) {
  return (
    <Frame {...props}>
      <rect x={22} y={12} width={76} height={56} rx={1} />
      <path d="M60 12v26M22 38h20M60 38h38" />
      <path d="M48 38h12" strokeOpacity={0.35} strokeDasharray="3 3" />
      {/* Door leaf + swing arc in the lower wall */}
      <path d="M74 68V56" />
      <path d="M74 56a12 12 0 0 1 12 12" strokeOpacity={0.55} />
      <rect x={28} y={56} width={10} height={6} strokeOpacity={0.45} />
    </Frame>
  )
}

function SectionSketch(props: SvgProps) {
  return (
    <Frame {...props}>
      <path d="M10 64h100" />
      <path d="M32 64V36L60 18l28 18v28" />
      <path d="M32 50h56" strokeOpacity={0.55} />
      <path d="M32 36h56" strokeOpacity={0.35} />
      {/* Ground hatch */}
      <path d="M16 70l5-5M30 70l5-5M44 70l5-5M72 70l5-5M86 70l5-5M100 70l5-5" strokeOpacity={0.4} strokeWidth={1} />
    </Frame>
  )
}

function SitePlanSketch(props: SvgProps) {
  return (
    <Frame {...props}>
      <path d="M18 22l80-8 10 46-76 12z" strokeDasharray="5 4" strokeOpacity={0.7} />
      <rect x={46} y={32} width={26} height={18} />
      <path d="M46 41h26M59 32v18" strokeOpacity={0.35} />
      {/* North arrow */}
      <path d="M104 34V18" strokeOpacity={0.7} />
      <path d="M100 24l4-6 4 6" strokeOpacity={0.7} />
    </Frame>
  )
}

function DocumentSketch(props: SvgProps) {
  return (
    <Frame {...props}>
      <path d="M38 10h32l14 14v46H38z" />
      <path d="M70 10v14h14" />
      <path d="M46 34h28M46 42h28M46 50h28M46 58h18" strokeOpacity={0.5} />
    </Frame>
  )
}

function NoticeSketch(props: SvgProps) {
  return (
    <Frame {...props}>
      <path d="M38 10h32l14 14v46H38z" />
      <path d="M70 10v14h14" />
      <path d="M46 24h16M46 32h28M46 40h28" strokeOpacity={0.5} />
      <circle cx={72} cy={55} r={8} strokeOpacity={0.6} />
      <path d="M44 60c3-6 6 2 9-3s5 2 8-2" strokeOpacity={0.7} />
    </Frame>
  )
}

function PhotoSketch(props: SvgProps) {
  return (
    <Frame {...props}>
      <rect x={26} y={16} width={68} height={48} rx={3} />
      <circle cx={44} cy={31} r={5} strokeOpacity={0.65} />
      <path d="M30 58l18-18 10 10 12-14 20 22" />
    </Frame>
  )
}

function ModelSketch(props: SvgProps) {
  return (
    <Frame {...props}>
      <path d="M60 12 90 27v30L60 72 30 57V27z" />
      <path d="M60 12v30l30 15M60 42 30 27" strokeOpacity={0.5} />
      <path d="M30 42l30 15 30-15" strokeOpacity={0.35} />
      <rect x={52} y={50} width={12} height={14} strokeOpacity={0.6} />
    </Frame>
  )
}

function SheetSketch(props: SvgProps) {
  return (
    <Frame {...props}>
      <rect x={30} y={14} width={60} height={52} rx={1} />
      {/* The header row is what makes a grid a TABLE rather than graph paper. */}
      <path d="M30 26h60" />
      <path d="M50 14v52M70 14v52" strokeOpacity={0.45} />
      <path d="M30 40h60M30 53h60" strokeOpacity={0.45} />
    </Frame>
  )
}

function TextSketch(props: SvgProps) {
  return (
    <Frame {...props}>
      <path d="M38 10h32l14 14v46H38z" />
      <path d="M70 10v14h14" />
      <path d="M46 33h18" strokeWidth={2.5} />
      <circle cx={47.5} cy={44} r={1.3} fill="currentColor" stroke="none" fillOpacity={0.6} />
      <circle cx={47.5} cy={52} r={1.3} fill="currentColor" stroke="none" fillOpacity={0.6} />
      <circle cx={47.5} cy={60} r={1.3} fill="currentColor" stroke="none" fillOpacity={0.6} />
      <path d="M53 44h21M53 52h21M53 60h14" strokeOpacity={0.5} />
    </Frame>
  )
}

const SKETCHES: Record<DocumentKind, (props: SvgProps) => JSX.Element> = {
  floorplan: FloorPlanSketch,
  section: SectionSketch,
  siteplan: SitePlanSketch,
  notice: NoticeSketch,
  photo: PhotoSketch,
  model: ModelSketch,
  sheet: SheetSketch,
  text: TextSketch,
  document: DocumentSketch,
}

function FillSvg({ children }: { children: ReactNode }) {
  return (
    <svg
      className="h-full w-full"
      viewBox="0 0 200 96"
      preserveAspectRatio="xMidYMid meet"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

function FloorPlanFill() {
  return (
    <FillSvg>
      <rect x={2} y={2} width={196} height={92} strokeWidth={1.6} strokeOpacity={0.85} />
      <path
        d="M80 2v34M80 56v38M80 56h118M138 2v22M138 40v16M2 74h34M50 74h30"
        strokeWidth={1.6}
        strokeOpacity={0.85}
      />
      <path
        d="M80 36a20 20 0 0 1 20 20M138 24a16 16 0 0 1 16 16"
        strokeWidth={1.3}
        strokeOpacity={0.4}
        strokeDasharray="2.5 3"
      />
    </FillSvg>
  )
}

function SectionFill() {
  return (
    <FillSvg>
      <path d="M4 90h192" strokeWidth={1.6} strokeOpacity={0.85} />
      <path d="M48 90V44L100 14l52 30v46" strokeWidth={1.6} strokeOpacity={0.85} />
      <path d="M48 68h104M48 44h104" strokeWidth={1.6} strokeOpacity={0.85} />
      <path d="M22 44h14M166 44h14" strokeWidth={1.3} strokeOpacity={0.4} strokeDasharray="2.5 3" />
    </FillSvg>
  )
}

function SitePlanFill() {
  return (
    <FillSvg>
      <rect x={4} y={4} width={192} height={88} strokeWidth={1.3} strokeOpacity={0.4} strokeDasharray="5 4" />
      <rect
        x={52}
        y={24}
        width={66}
        height={46}
        fill="currentColor"
        fillOpacity={0.07}
        strokeWidth={1.6}
        strokeOpacity={0.85}
      />
      <path d="M156 66V34M151 39l5-5 5 5" strokeWidth={1.5} strokeOpacity={0.4} />
    </FillSvg>
  )
}

function DocumentFill() {
  return (
    <div className="absolute inset-0 flex flex-col gap-[6px] px-[18px] py-[15px]">
      <div className="h-[6px] w-[52%] rounded-full bg-current opacity-40" />
      <div className="mb-[5px] h-[4px] w-[30%] rounded-control bg-current opacity-20" />
      {[100, 94, 97, 88, 96, 62].map((w, i) => (
        <div key={i} className="h-[4px] rounded-control bg-current opacity-20" style={{ width: `${w}%` }} />
      ))}
    </div>
  )
}

function NoticeFill() {
  return (
    <div className="absolute inset-0 flex flex-col gap-[6px] px-[18px] py-[15px]">
      <div className="mb-[6px] flex items-start justify-between">
        <div className="flex flex-col gap-[4px]">
          <div className="h-[5px] w-16 rounded-control bg-current opacity-40" />
          <div className="h-[4px] w-10 rounded-control bg-current opacity-20" />
        </div>
        <div className="size-[18px] shrink-0 rounded-full border-[1.5px] border-current opacity-40" />
      </div>
      {[100, 92, 96, 70, 88, 54].map((w, i) => (
        <div key={i} className="h-[4px] rounded-control bg-current opacity-20" style={{ width: `${w}%` }} />
      ))}
      <div className="absolute bottom-3 right-4 flex size-10 -rotate-12 items-center justify-center rounded-full border-[1.5px] border-current opacity-30">
        <div className="h-[3px] w-5 rounded-control bg-current" />
      </div>
    </div>
  )
}

function ModelFill() {
  return (
    <FillSvg>
      <path d="M100 8 168 42v38L100 114 32 80V42z" strokeWidth={1.6} strokeOpacity={0.85} />
      <path d="M100 8v42l68 30M100 50 32 42" strokeWidth={1.5} strokeOpacity={0.5} />
      <path d="M32 62l68 34 68-34" strokeWidth={1.3} strokeOpacity={0.3} strokeDasharray="4 4" />
      <rect
        x={86}
        y={66}
        width={28}
        height={26}
        fill="currentColor"
        fillOpacity={0.07}
        strokeWidth={1.4}
        strokeOpacity={0.55}
      />
    </FillSvg>
  )
}

function SheetFill() {
  return (
    <FillSvg>
      <rect x={2} y={2} width={196} height={92} strokeWidth={1.6} strokeOpacity={0.85} />
      <rect x={2} y={2} width={196} height={24} fill="currentColor" fillOpacity={0.16} stroke="none" />
      <path d="M2 26h196" strokeWidth={1.8} strokeOpacity={0.85} />
      <path d="M2 49h196M2 72h196" strokeWidth={1.2} strokeOpacity={0.3} />
      <path d="M62 2v92M118 2v92M160 2v92" strokeWidth={1.2} strokeOpacity={0.3} />
    </FillSvg>
  )
}

function TextFill() {
  return (
    <div className="absolute inset-0 flex flex-col gap-[6px] px-[18px] py-[15px]">
      <div className="h-[7px] w-[46%] rounded-full bg-current opacity-45" />
      <div className="h-[4px] w-full rounded-control bg-current opacity-20" />
      <div className="mb-[3px] h-[4px] w-[78%] rounded-control bg-current opacity-20" />
      {[86, 94, 62].map((w, i) => (
        <div key={i} className="flex items-center gap-[7px]">
          <span className="size-[4px] shrink-0 rounded-full bg-current opacity-35" />
          <span className="h-[4px] rounded-control bg-current opacity-20" style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  )
}

const FILLS: Record<DocumentKind, () => JSX.Element> = {
  floorplan: FloorPlanFill,
  section: SectionFill,
  siteplan: SitePlanFill,
  notice: NoticeFill,
  photo: DocumentFill,
  model: ModelFill,
  sheet: SheetFill,
  text: TextFill,
  document: DocumentFill,
}

const FILL_PADDED: Record<DocumentKind, boolean> = {
  floorplan: true,
  section: true,
  siteplan: true,
  notice: false,
  photo: false,
  model: true,
  sheet: true,
  text: false,
  document: false,
}

export function DocumentKindThumbnail({
  kind,
  className,
  variant = 'icon',
  formatLabel,
  failed = false,
  failedLabel,
}: {
  kind: DocumentKind
  className?: string
  variant?: 'icon' | 'fill'
  formatLabel?: string
  failed?: boolean
  failedLabel?: string
}) {
  if (variant === 'fill') {
    if (failed) {
      return (
        <div
          aria-hidden
          data-kind={kind}
          data-testid="document-kind-thumbnail"
          data-state="failed"
          title={failedLabel}
          className={cn(
            'absolute inset-0 flex flex-col items-center justify-center bg-sheet text-muted-foreground',
            className
          )}
        >
          {/* The glyph alone, at the 16px of every glyph on the tile: a centred sentence on grey made it the
              loudest tile in the grid, and the tile's name already says what the file is. The words stay as its title. */}
          <ImageOff className="size-4 opacity-60" aria-hidden />
          {failedLabel && <span className="sr-only">{failedLabel}</span>}
        </div>
      )
    }

    if (kind === 'photo') {
      return (
        <div
          aria-hidden
          data-kind={kind}
          data-testid="document-kind-thumbnail"
          data-state="placeholder"
          className={cn(
            'absolute inset-0 flex flex-col items-center justify-center gap-2 bg-sheet text-muted-foreground',
            className
          )}
        >
          <ImageIcon className="size-[26px] opacity-45" aria-hidden />
          {formatLabel && (
            <span
              className="text-[11px] font-medium uppercase leading-4 tracking-wider"
            >
              {formatLabel}
            </span>
          )}
        </div>
      )
    }

    const Fill = FILLS[kind] ?? DocumentFill
    return (
      <div
        aria-hidden
        data-kind={kind}
        data-testid="document-kind-thumbnail"
        data-state="placeholder"
        className={cn(
          'absolute inset-0 text-muted-foreground',
          FILL_PADDED[kind] && 'px-[18px] py-[14px]',
          className
        )}
      >
        <Fill />
      </div>
    )
  }

  const Sketch = SKETCHES[kind] ?? DocumentSketch
  return <Sketch className={className} data-kind={kind} data-testid="document-kind-thumbnail" />
}
