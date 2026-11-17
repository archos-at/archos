'use client'

import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

export function useErrorToast(error: string | null): void {
  const lastToasted = useRef<string | null>(null)
  useEffect(() => {
    if (error && error !== lastToasted.current) {
      lastToasted.current = error
      toast.error(error)
    }
    if (!error) lastToasted.current = null
  }, [error])
}
