import { useEffect, type ComponentProps } from 'react'
import type * as PopoverModule from '@/components/ui/popover'

export const popoverMounts = { current: 0, total: 0 }

export const resetPopoverMounts = (): void => {
  popoverMounts.current = 0
  popoverMounts.total = 0
}

export const countPopoverMounts = (actual: typeof PopoverModule): typeof PopoverModule => {
  const Popover = (props: ComponentProps<typeof actual.Popover>) => {
    useEffect(() => {
      popoverMounts.current += 1
      popoverMounts.total += 1
      return () => {
        popoverMounts.current -= 1
      }
    }, [])
    return <actual.Popover {...props} />
  }
  return { ...actual, Popover }
}
