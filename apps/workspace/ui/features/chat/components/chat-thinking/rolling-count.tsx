import { type FC, useLayoutEffect, useRef } from 'react'
import type { Transition } from 'motion/react'
import { AnimatePresence, motion } from '@/components/motion'
import type { RollMotion } from './roll-motion'

export const RollingCount: FC<{ value: string; after: string; roll: RollMotion }> = ({ value, after, roll }) => {
  const sizer = useRef<HTMLSpanElement>(null)
  const tail = useRef<HTMLSpanElement>(null)
  const lastWidth = useRef<number | null>(null)
  useLayoutEffect(() => {
    const next = sizer.current?.getBoundingClientRect().width ?? 0
    const previous = lastWidth.current
    lastWidth.current = next
    const duration = (roll.animate.transition.duration ?? 0) * 1000
    if (previous === null || Math.abs(previous - next) < 0.5 || duration === 0) return
    tail.current?.animate?.(
      [{ transform: `translateX(${previous - next}px)` }, { transform: 'translateX(0)' }],
      { duration, easing: cssEasing(roll.animate.transition.ease) }
    )
  }, [value, roll.animate.transition])
  return (
    <>
      <span className="relative inline-grid overflow-hidden align-top tabular-nums">
        {/* Generated content, so the sizer's digits are not in the label's text. */}
        <span
          ref={sizer}
          aria-hidden="true"
          data-text={value}
          className="invisible absolute whitespace-nowrap before:content-[attr(data-text)]"
        />
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={value} data-derivation-count className="col-start-1 row-start-1" {...roll}>
            {value}
          </motion.span>
        </AnimatePresence>
      </span>
      <span ref={tail} className="inline-block whitespace-pre">
        {after}
      </span>
    </>
  )
}

const cssEasing = (ease: Transition['ease']): string =>
  Array.isArray(ease) && ease.length === 4 && ease.every((n) => typeof n === 'number')
    ? `cubic-bezier(${ease.join(', ')})`
    : 'ease-out'
