import { useEffect, useState } from 'react'

export const useThrottledText = (text: string, gapMs: number): string => {
  const [shown, setShown] = useState(text)
  const [shownAt, setShownAt] = useState(0)
  useEffect(() => {
    if (text === shown) return
    const wait = Math.max(0, shownAt + gapMs - Date.now())
    const id = setTimeout(() => {
      setShown(text)
      setShownAt(Date.now())
    }, wait)
    return () => clearTimeout(id)
  }, [text, shown, shownAt, gapMs])
  return shown
}
