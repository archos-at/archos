import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

export const TYPE_SCALE = ['meta', 'name', 'section', 'pane-title', 'page-title', 'answer'] as const
export const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      rounded: [{ rounded: ['inline', 'control', 'surface', 'overlay', 'bubble'] }],
      'font-size': [{ text: [...TYPE_SCALE] }],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
