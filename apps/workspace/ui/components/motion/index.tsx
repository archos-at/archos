'use client'

import { type ReactNode, useSyncExternalStore } from 'react'
import { motion, type HTMLMotionProps, type Transition, type Variants } from 'motion/react'

type Bezier = [number, number, number, number]

const EASE_OUT: Bezier = [0.23, 1, 0.32, 1]

const EASE_ENTRANCE: Bezier = [0.16, 1, 0.3, 1]

const EASE_EXIT: Bezier = [0.23, 1, 0.32, 1]

export interface SpringTransition {
  readonly type: 'spring'
  readonly stiffness: number
  readonly damping: number
  readonly mass: number
}

export const springPress: SpringTransition = {
  type: 'spring',
  stiffness: 600,
  damping: 38,
  mass: 0.6,
}

export const springSnap: SpringTransition = {
  type: 'spring',
  stiffness: 520,
  damping: 30,
  mass: 1,
}

export const springDrawer: SpringTransition = {
  type: 'spring',
  stiffness: 260,
  damping: 26,
  mass: 1,
}

export const springGlide: SpringTransition = {
  type: 'spring',
  stiffness: 260,
  damping: 29,
  mass: 1,
}

export const springSnapLinear =
  'linear(0, 0.0723, 0.237, 0.4331, 0.6213, 0.7801, 0.9009, 0.9837, 1.0336, 1.058, 1.0643, 1.0595, 1.0488, 1.0362, 1.0241, 1.0139, 1.0062, 1.001, 0.9978, 0.9963, 0.9959, 0.9962, 0.9969, 0.9977, 1)'

export const springSnapSettleSeconds = 0.44

export const springSnapLinearDuration = `${springSnapSettleSeconds * 1000}ms`

export const springDrawerLinear =
  'linear(0, 0.0505, 0.167, 0.3102, 0.4555, 0.5885, 0.7023, 0.7945, 0.866, 0.9191, 0.9568, 0.9822, 0.9984, 1.0077, 1.0123, 1.0138, 1.0134, 1.0119, 1.0099, 1.0079, 1.006, 1.0044, 1.0031, 1.002, 1)'

export const springDrawerLinearDuration = '520ms'

export const motionSnap: Transition = { duration: 0.12, ease: EASE_OUT }

export const motionQuick: Transition = { duration: 0.18, ease: EASE_OUT }

export const motionBase: Transition = { duration: 0.24, ease: EASE_OUT }

export const motionEntrance: Transition = { duration: 0.24, ease: EASE_ENTRANCE }

export const motionQuickExit: Transition = { duration: 0.18, ease: EASE_EXIT }

export const motionDeliberate: Transition = { duration: 0.32, ease: EASE_OUT }

export const motionInstant: Transition = { duration: 0, delay: 0 }

export function asWebAnimation(token: Transition): KeyframeAnimationOptions {
  const seconds = typeof token.duration === 'number' ? token.duration : 0
  const ease = Array.isArray(token.ease) && token.ease.length === 4 ? `cubic-bezier(${token.ease.join(', ')})` : 'ease-out'
  return { duration: seconds * 1000, easing: ease }
}

export function useMotionToken<T extends Transition | SpringTransition>(
  token: T
): T | typeof motionInstant {
  return usePrefersReducedMotion() ? motionInstant : token
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false)
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

let reducedMotionList: { list: MediaQueryList; from: typeof window.matchMedia } | null = null

function reducedMotionQuery(): MediaQueryList | null {
  if (typeof window.matchMedia !== 'function') return null
  if (reducedMotionList?.from !== window.matchMedia) {
    reducedMotionList = { list: window.matchMedia(REDUCED_MOTION_QUERY), from: window.matchMedia }
  }
  return reducedMotionList.list
}

function readReducedMotion(): boolean {
  return reducedMotionQuery()?.matches ?? false
}

function subscribeReducedMotion(onChange: () => void): () => void {
  const mql = reducedMotionQuery()
  if (!mql) return () => {}
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

export const iconSwapTransition: Transition = { ...springSnap, opacity: motionQuick }

export const iconSwapExitTransition: Transition = motionQuickExit

export function useIconSwapTransition(): { enter: Transition; exit: Transition } {
  const enter = useMotionToken(iconSwapTransition)
  const exit = useMotionToken(iconSwapExitTransition)
  return { enter, exit }
}

export const motionDeliberateEntrance: Transition = { duration: 0.32, ease: EASE_ENTRANCE }

export const motionSheetEnter: Transition = motionDeliberateEntrance

export const motionSheetExit: Transition = { duration: 0.24, ease: EASE_EXIT }

export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0 },
}

export const staggerStepSeconds = 0.04

export const staggerMaxSteps = 5

export const staggerParent: Variants = {
  hidden: {},
  visible: {
    transition: {
      delayChildren: (index: number) => Math.min(index, staggerMaxSteps) * staggerStepSeconds,
    },
  },
}

interface FadeInProps extends HTMLMotionProps<'div'> {
  children?: ReactNode
  delay?: number
  distance?: number
}

export const FadeIn = ({ children, delay = 0, distance = 8, ...props }: FadeInProps): ReactNode => (
  <motion.div
    initial={{ opacity: 0, y: distance }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ ...motionEntrance, delay }}
    {...props}
  >
    {children}
  </motion.div>
)

interface StaggerProps extends HTMLMotionProps<'div'> {
  children?: ReactNode
  inView?: boolean
}

export const Stagger = ({ children, inView = false, ...props }: StaggerProps): ReactNode => (
  <motion.div
    variants={staggerParent}
    initial="hidden"
    {...(inView
      ? { whileInView: 'visible', viewport: { once: true, margin: '-64px' } }
      : { animate: 'visible' })}
    {...props}
  >
    {children}
  </motion.div>
)

export const StaggerItem = ({ children, ...props }: HTMLMotionProps<'div'>): ReactNode => (
  <motion.div variants={fadeRise} transition={motionEntrance} {...props}>
    {children}
  </motion.div>
)

export { motion, AnimatePresence, LayoutGroup } from 'motion/react'
