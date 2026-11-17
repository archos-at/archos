'use client'

import {
  type CSSProperties,
  type FC,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { AlertTriangle, ChevronDown, HelpCircle } from 'lucide-react'
import {
  animate,
  type MotionValue,
  useMotionValue,
  useReducedMotionConfig,
  useTransform,
} from 'motion/react'

import {
  AnimatePresence,
  motion,
  springGlide,
} from '@/components/motion'
import { HeightArrival } from '@/components/motion/height-arrival'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { CHAT_EFFORTS, chatEffortFromSettings } from '@/lib/reasoning-settings/catalog'
import { cn } from '@/lib/utils'

import { effectiveEffort, useEffortStore } from '../../stores/effort-store'

const MAXIMUM = CHAT_EFFORTS[CHAT_EFFORTS.length - 1]

const WARNING_ROOM = 96

let orgDefaultRequest: Promise<void> | null = null

function loadOrgDefault(): Promise<void> {
  orgDefaultRequest ??= fetch('/api/organization/settings')
    .then((response) => (response.ok ? response.json() : null))
    .then((body: { settings?: { settings?: Record<string, unknown> } } | null) => {
      if (body?.settings) {
        useEffortStore.getState().setOrgDefault(chatEffortFromSettings(body.settings.settings))
      }
    })
    .catch(() => undefined)
  return orgDefaultRequest
}

type PopoverSide = 'top' | 'bottom'

function useStickySide(): {
  side: PopoverSide
  observeSide: (node: HTMLDivElement | null) => void
  resetSide: () => void
} {
  const [side, setSide] = useState<PopoverSide>('top')
  const observer = useRef<MutationObserver | null>(null)

  const observeSide = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!node) return
    observer.current = new MutationObserver(() => {
      const placed = node.dataset.side
      if (placed === 'top' || placed === 'bottom') setSide(placed)
    })
    observer.current.observe(node, { attributes: true, attributeFilter: ['data-side'] })
  }, [])

  return { side, observeSide, resetSide: useCallback(() => setSide('top'), []) }
}

export function resetEffortDialDefaultRequest(): void {
  orgDefaultRequest = null
}

interface EffortDialProps {
  conversationId: string | null | undefined
  disabled?: boolean
  hidden?: boolean
  focusOnHide?: RefObject<HTMLElement | null>
  className?: string
}

export const EffortDial: FC<EffortDialProps> = ({
  conversationId,
  disabled = false,
  hidden = false,
  focusOnHide,
  className,
}) => {
  const t = useTranslations(chatCopy)
  const effort = useEffortStore((state) => effectiveEffort(state, conversationId))
  const choose = useEffortStore((state) => state.choose)

  useEffect(() => {
    void loadOrgDefault()
  }, [])

  const { side, observeSide, resetSide } = useStickySide()
  const index = CHAT_EFFORTS.indexOf(effort)
  const label = t(`effortDial.levels.${effort}`)
  const isMaximum = effort === MAXIMUM
  const [open, setOpen] = useState(false)

  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (!hidden) return
    const focused = document.activeElement
    if (!(focused instanceof HTMLElement)) return
    const holdsFocus =
      (triggerRef.current?.contains(focused) ?? false) ||
      (contentRef.current?.contains(focused) ?? false)
    if (!holdsFocus) return
    if (focusOnHide?.current) focusOnHide.current.focus()
    else focused.blur()
  }, [hidden, focusOnHide])

  const setContent = useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node
      observeSide(node)
    },
    [observeSide]
  )

  return (
    <Popover
      open={open && !hidden}
      onOpenChange={(next) => {
        if (next) resetSide()
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          variant="ghost"
          size="sm"
          data-testid="effort-dial-trigger"
          className={cn(
            'text-muted-foreground h-8 gap-1 rounded-control px-2.5 text-xs font-medium',
            isMaximum && 'text-warning hover:text-warning',
            hidden && 'invisible',
            className
          )}
          disabled={disabled}
          aria-hidden={hidden || undefined}
          tabIndex={hidden ? -1 : undefined}
          aria-label={t('effortDial.trigger', { level: label })}
          title={t('effortDial.trigger', { level: label })}
        >
          {/* Every level's name stacked in one cell, only the current one
              visible: the chip is as wide as the longest name at every level,
              so turning the dial never moves the controls beside it. */}
          <span className="grid" data-testid="effort-dial-label">
            {CHAT_EFFORTS.map((level) => (
              <span
                key={level}
                className={cn('col-start-1 row-start-1', level !== effort && 'invisible')}
                aria-hidden={level !== effort || undefined}
              >
                {t(`effortDial.levels.${level}`)}
              </span>
            ))}
          </span>
          <ChevronDown className="size-3" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={setContent}
        side={side}
        align="end"
        sideOffset={8}
        collisionPadding={isMaximum ? 0 : { top: WARNING_ROOM, bottom: WARNING_ROOM }}
        className="group/effort flex w-72 flex-col p-4"
        data-testid="effort-dial"
        onCloseAutoFocus={(event) => {
          if (hidden) event.preventDefault()
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm">
            <span className="text-muted-foreground">{t('effortDial.title')}</span>{' '}
            <span className="font-medium" data-testid="effort-dial-level">
              {label}
            </span>
          </p>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground rounded-full"
                aria-label={t('effortDial.help')}
              >
                <HelpCircle className="size-4" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">{t('effortDial.help')}</TooltipContent>
          </Tooltip>
        </div>

        <AnimatePresence initial={false}>
          {isMaximum && (
            <HeightArrival
              key="maximum-warning"
              className="group-data-[side=bottom]/effort:order-last"
            >
              <Alert
                variant="warning"
                data-testid="effort-dial-maximum-warning"
                className="mt-3 px-3 py-2.5 text-xs"
              >
                <AlertTriangle aria-hidden="true" />
                <AlertDescription className="text-xs">
                  {t('effortDial.maximumWarning')}
                </AlertDescription>
              </Alert>
            </HeightArrival>
          )}
        </AnimatePresence>

        <div className="text-muted-foreground mt-4 flex justify-between text-xs" aria-hidden="true">
          <span>{t('effortDial.faster')}</span>
          <span>{t('effortDial.smarter')}</span>
        </div>
        <EffortSlider
          label={t('effortDial.title')}
          index={index}
          valueText={label}
          onChoose={(next) => choose(conversationId, next)}
        />
      </PopoverContent>
    </Popover>
  )
}

interface EffortSliderProps {
  label: string
  index: number
  valueText: string
  onChoose: (level: (typeof CHAT_EFFORTS)[number]) => void
}

const THUMB = 28
const INSET = 4

const RAIL: CSSProperties = { left: INSET + THUMB / 2, right: INSET + THUMB / 2 }

const TRAVEL: CSSProperties = { left: INSET, width: `calc(100% - ${2 * INSET + THUMB}px)` }

const RAMP_DOTS: CSSProperties = {
  backgroundImage: [
    'linear-gradient(to right,',
    'color-mix(in oklch, var(--foreground) 18%, transparent),',
    'color-mix(in oklch, var(--foreground) 78%, transparent) 70%,',
    'var(--text-color-feedback-warning))',
  ].join(' '),
  maskImage: 'radial-gradient(circle, black 1.1px, transparent 1.6px)',
  maskSize: '6px 6px',
  maskPosition: 'left center',
}

function revealTo(share: number): string {
  return `inset(0 calc(${1 - share} * (100% - ${THUMB}px) + ${THUMB / 2}px) 0 0 round 8px)`
}

const THUMB_FACE: CSSProperties = {
  backgroundColor: 'var(--foreground)',
}

const Stop: FC<{ position: MotionValue<number>; at: number }> = ({ position, at }) => {
  const opacity = useTransform(position, (value) => (value >= at - 0.001 ? 0 : 1))
  return (
    <motion.span
      data-testid="effort-dial-stop"
      className="bg-muted-foreground/40 absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{ left: `${at * 100}%`, opacity }}
    />
  )
}

const EffortSlider: FC<EffortSliderProps> = ({ label, index, valueText, onChoose }) => {
  const sliderId = useId()
  const reducedMotion = useReducedMotionConfig()
  const share = index / (CHAT_EFFORTS.length - 1)
  const position = useMotionValue(share)
  const x = useTransform(position, (value) => `${value * 100}%`)
  const reveal = useTransform(position, revealTo)

  useEffect(() => {
    if (reducedMotion) {
      position.jump(share)
      return
    }
    const glide = animate(position, share, springGlide)
    return () => glide.stop()
  }, [position, share, reducedMotion])

  return (
    <div
      className="bg-muted pointer-coarse:h-11 group relative mt-2 h-10 overflow-hidden rounded-surface"
    >
      <div className="pointer-events-none absolute inset-y-0" style={RAIL} aria-hidden="true">
        {CHAT_EFFORTS.map((level, stop) => (
          <Stop key={level} position={position} at={stop / (CHAT_EFFORTS.length - 1)} />
        ))}
      </div>
      <motion.div
        className="pointer-events-none absolute inset-1"
        style={{ clipPath: reveal }}
        aria-hidden="true"
        data-testid="effort-dial-fill"
        data-share={share}
      >
        <span className="bg-foreground/5 absolute inset-0 rounded-control" />
        <span className="absolute inset-0" style={RAMP_DOTS} />
      </motion.div>
      <motion.div
        className="pointer-events-none absolute inset-y-1"
        style={{ ...TRAVEL, x }}
        aria-hidden="true"
        data-testid="effort-dial-thumb"
        data-share={share}
      >
        <span
          className={cn(
            'absolute inset-y-0 left-0 flex w-7 items-center justify-center gap-[3px] rounded-control',
            'duration-quick transition-transform ease-out motion-reduce:transition-none',
            'group-has-[input:active]:scale-[0.94]',
            'group-has-[input:focus-visible]:ring-ring/60 group-has-[input:focus-visible]:ring-offset-muted group-has-[input:focus-visible]:ring-2 group-has-[input:focus-visible]:ring-offset-2'
          )}
          style={THUMB_FACE}
        >
          <span className="bg-background/35 h-3 w-px rounded-full" />
          <span className="bg-background/35 h-3 w-px rounded-full" />
        </span>
      </motion.div>
      <label htmlFor={sliderId} className="sr-only">
        {label}
      </label>
      <input
        id={sliderId}
        type="range"
        data-testid="effort-dial-slider"
        className={cn(
          'absolute inset-1 z-10 h-[calc(100%-8px)] w-[calc(100%-8px)] cursor-pointer appearance-none opacity-0',
          '[&::-webkit-slider-thumb]:h-8 [&::-webkit-slider-thumb]:w-7 [&::-webkit-slider-thumb]:appearance-none',
          '[&::-moz-range-thumb]:h-8 [&::-moz-range-thumb]:w-7 [&::-moz-range-thumb]:border-0'
        )}
        min={0}
        max={CHAT_EFFORTS.length - 1}
        step={1}
        value={index}
        aria-valuetext={valueText}
        onChange={(event) => {
          const next = CHAT_EFFORTS[Number(event.target.value)]
          if (next) onChoose(next)
        }}
      />
    </div>
  )
}
