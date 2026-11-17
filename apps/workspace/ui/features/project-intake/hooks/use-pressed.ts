'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export function usePressed(): [boolean, (work: () => Promise<unknown>) => void] {
  const [pressed, setPressed] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const press = useCallback((work: () => Promise<unknown>): void => {
    setPressed(true)
    void work().finally(() => {
      if (mounted.current) setPressed(false)
    })
  }, [])

  return [pressed, press]
}
