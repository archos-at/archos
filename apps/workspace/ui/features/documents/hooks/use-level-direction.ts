'use client'

import { useState } from 'react'

export function useLevelDirection(depth: number): number {
  const [previous, setPrevious] = useState(depth)
  const [direction, setDirection] = useState(0)

  if (previous === depth) return direction

  const next = depth > previous ? 1 : -1
  setPrevious(depth)
  setDirection(next)
  return next
}
