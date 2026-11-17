'use client'

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { NextStep, NextStepProvider, useNextStep, type CardComponentProps } from 'nextstepjs'
import { useReducedMotion } from 'motion/react'

import { motionDeliberate, motionInstant } from '@/components/motion'
import { TourCard } from '@/components/ui/tour-card'
import { ShortcutKeys } from '@/components/shell/shortcut-keys'
import { MOD } from '@/components/shell/shortcuts'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useTranslations } from '@/i18n'
import { onboardingCopy } from '@/i18n/namespaces/onboarding'
import { capturePosthog } from '@/lib/analytics/posthog'
import { patchUserPreferences } from '@/lib/user-preferences/client'
import {
  ARRIVAL_ANCHOR,
  NO_TOURS,
  TOURS,
  TOUR_HOME,
  TOUR_PLACEMENT_ATTRIBUTE,
  TOUR_SEEN_KEYS,
  isSetupPage,
  placeStops,
  requestedTour,
  tourAnchorSelector,
  tourForPath,
  withoutTourRequest,
  type AnchorBox,
  type PlacedTourStop,
  type TourEligibility,
  type TourFlags,
  type TourId,
} from '@/lib/onboarding/product-tour'
import type { JSX } from 'react'

const ARRIVAL_TIMEOUT_MS = 5000
const ARRIVAL_POLL_MS = 100
const ARRIVAL_SETTLE_MS = 400

const StartTourContext = React.createContext<(() => void) | null>(null)
const PlacedStopsContext = React.createContext<readonly PlacedTourStop[]>([])

export interface ProductTourProps extends TourFlags {
  children: React.ReactNode
  eligible?: TourEligibility
  tourAt?: (pathname: string) => TourId | null
}

export function ProductTour({ children, ...options }: ProductTourProps): JSX.Element {
  return (
    <NextStepProvider>
      <ProductTourRunner {...options}>{children}</ProductTourRunner>
    </NextStepProvider>
  )
}

export function useStartProductTour(): () => void {
  return React.useContext(StartTourContext) ?? noop
}

function noop(): void {}

function ProductTourRunner({
  children,
  canAccessOfficeShelf,
  canAccessInbox,
  canManageOrganization,
  eligible = NO_TOURS,
  tourAt = tourForPath,
}: ProductTourProps): JSX.Element {
  const pathname = usePathname() ?? ''
  const router = useRouter()
  const reduceMotion = useReducedMotion()
  const { startNextStep } = useNextStep()
  const phone = useIsMobile()
  const t = useTranslations(onboardingCopy, 'tour')
  const [active, setActive] = React.useState<{ tour: TourId; stops: PlacedTourStop[] } | null>(null)
  const startedRef = React.useRef(new Set<TourId>())
  const pendingReplayRef = React.useRef<TourId | null>(null)
  const here = tourAt(pathname)

  const startHere = React.useCallback(
    (tour: TourId, handover: boolean) => {
      const reader = { canAccessOfficeShelf, canAccessInbox, canManageOrganization, handover, phone }
      const stops = placeStops(TOURS[tour], reader, locateAnchor, {
        width: window.innerWidth,
        height: window.innerHeight,
      })
      setActive({ tour, stops })
      startNextStep(tour)
      if (!startedRef.current.has(tour)) {
        startedRef.current.add(tour)
        void patchUserPreferences({ [TOUR_SEEN_KEYS[tour]]: new Date().toISOString() })
      }
    },
    [canAccessOfficeShelf, canAccessInbox, canManageOrganization, phone, startNextStep],
  )

  const start = React.useCallback(() => {
    if (here) {
      startHere(here, false)
      return
    }
    pendingReplayRef.current = 'welcome'
    router.push(TOUR_HOME)
  }, [here, router, startHere])

  const autoStart = here !== null && eligible[here] && !isSetupPage(pathname)
  React.useEffect(() => {
    const replay = pendingReplayRef.current
    if (replay && replay === here) {
      pendingReplayRef.current = null
      return waitForArrival(replay, () => startHere(replay, false))
    }
    const requested = requestedTour(window.location.search)
    const handover = requested !== null && requested === here
    if (requested) router.replace(withoutTourRequest(pathname, window.location.search), { scroll: false })
    const tour = handover ? requested : autoStart ? here : null
    if (!tour || (!handover && startedRef.current.has(tour))) return
    return waitForArrival(tour, () => startHere(tour, handover))
  }, [autoStart, here, pathname, router, startHere])

  const tours = React.useMemo(
    () =>
      active
        ? [
            {
              tour: active.tour,
              steps: active.stops.map((stop) => ({
                title: t(`stops.${stop.id}.title`),
                content: <StopBody stop={stop} />,
                selector: stop.side && stop.anchor ? tourAnchorSelector(stop.anchor) : undefined,
                side: stop.side,
                pointerPadding: 12,
                pointerRadius: 12,
              })),
            },
          ]
        : [],
    [active, t],
  )

  const stopCount = active?.stops.length ?? 0

  return (
    <StartTourContext.Provider value={start}>
      <PlacedStopsContext.Provider value={active?.stops ?? EMPTY_STOPS}>
      <NextStep
        steps={tours}
        cardComponent={ProductTourCard}
        displayArrow={false}
        shadowRgb="0, 0, 0"
        shadowOpacity="0.32"
        cardTransition={reduceMotion ? motionInstant : motionDeliberate}
        scrollToTop={false}
        disableConsoleLogs
        onComplete={(tour) => capturePosthog('product_tour_completed', { tour, stops: stopCount })}
        onSkip={(step, tour) =>
          capturePosthog('product_tour_skipped', {
            tour,
            step,
            stop: active?.stops[step]?.id,
            stops: stopCount,
          })
        }
      >
        {children}
      </NextStep>
      </PlacedStopsContext.Provider>
    </StartTourContext.Provider>
  )
}

function waitForArrival(tour: TourId, start: () => void): () => void {
  const anchor = ARRIVAL_ANCHOR[tour]
  const startedAt = Date.now()
  const timer = window.setInterval(() => {
    const elapsed = Date.now() - startedAt
    const ready = anchor ? locateAnchor(tourAnchorSelector(anchor)) !== null : elapsed >= ARRIVAL_SETTLE_MS
    if (!ready && elapsed < ARRIVAL_TIMEOUT_MS) return
    window.clearInterval(timer)
    start()
  }, ARRIVAL_POLL_MS)
  return () => window.clearInterval(timer)
}

function locateAnchor(selector: string): AnchorBox | null {
  for (const element of Array.from(document.querySelectorAll(selector))) {
    const { left, right, top, bottom } = element.getBoundingClientRect()
    if (!(right > left && bottom > top)) continue
    const placement = element.getAttribute(TOUR_PLACEMENT_ATTRIBUTE)
    return placement === 'above' || placement === 'below' || placement === 'beside'
      ? { left, right, top, bottom, placement }
      : { left, right, top, bottom }
  }
  return null
}

const EMPTY_STOPS: readonly PlacedTourStop[] = []

function ProductTourCard({
  step,
  currentStep,
  totalSteps,
  nextStep,
  prevStep,
  skipTour,
}: CardComponentProps): JSX.Element {
  const t = useTranslations(onboardingCopy, 'tour')
  const shiftX = React.useContext(PlacedStopsContext)[currentStep]?.shiftX ?? 0
  return (
    <div style={shiftX ? { transform: `translateX(${shiftX}px)` } : undefined}>
    <TourCard
      title={step.title}
      step={currentStep}
      total={totalSteps}
      labels={{
        next: t('next'),
        back: t('back'),
        done: t('done'),
        close: t('close'),
        progress: t('progress', { current: currentStep + 1, total: totalSteps }),
      }}
      onNext={nextStep}
      onBack={prevStep}
      onClose={() => skipTour?.()}
    >
      {step.content}
    </TourCard>
    </div>
  )
}

function StopBody({ stop }: { stop: PlacedTourStop }): JSX.Element {
  const t = useTranslations(onboardingCopy, 'tour')
  if (stop.id === 'shortcuts') {
    return (
      <div className="space-y-3">
        <p>{t('stops.shortcuts.body')}</p>
        <dl className="space-y-2">
          <TourDetailRow term={t('stops.shortcuts.palette')}>
            <ShortcutKeys segments={[{ kind: 'chord', caps: [MOD, 'K'] }]} />
          </TourDetailRow>
          <TourDetailRow term={t('stops.shortcuts.cheatsheet')}>
            <ShortcutKeys segments={[{ kind: 'chord', caps: ['?'] }]} />
          </TourDetailRow>
        </dl>
      </div>
    )
  }
  if (stop.id === 'filesOrOfficeShelf') {
    return (
      <div className="space-y-3">
        <p>{t('stops.filesOrOfficeShelf.body')}</p>
        <dl className="space-y-2.5">
          <TourDetailRow term={t('stops.filesOrOfficeShelf.filesTerm')} stacked>
            {t('stops.filesOrOfficeShelf.filesDetail')}
          </TourDetailRow>
          <TourDetailRow term={t('stops.filesOrOfficeShelf.officeShelfTerm')} stacked>
            {t('stops.filesOrOfficeShelf.officeShelfDetail')}
          </TourDetailRow>
        </dl>
      </div>
    )
  }
  return <p>{t(`stops.${stop.id}.body`)}</p>
}

function TourDetailRow({
  term,
  stacked = false,
  children,
}: {
  term: string
  stacked?: boolean
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className={stacked ? 'space-y-0.5' : 'flex items-center justify-between gap-3'}>
      <dt className="text-foreground font-medium">{term}</dt>
      <dd>{children}</dd>
    </div>
  )
}
