'use client'

import { useEffect, useRef, type RefObject } from 'react'

export function useInputSinceMount(): RefObject<boolean> {
  const acted = useRef(false)
  useEffect(() => {
    const mark = (): void => {
      acted.current = true
      window.removeEventListener('pointerdown', mark, true)
      window.removeEventListener('keydown', mark, true)
    }
    window.addEventListener('pointerdown', mark, true)
    window.addEventListener('keydown', mark, true)
    return () => {
      window.removeEventListener('pointerdown', mark, true)
      window.removeEventListener('keydown', mark, true)
    }
  }, [])
  return acted
}
