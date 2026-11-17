import { type FC } from 'react'
import { BRAND_MARK, PRODUCT_NAME } from '@/lib/brand'
import { cn } from '@/lib/utils'

interface LogoProps {
  kind?: 'wordmark' | 'icon'
  size?: 'small' | 'medium' | 'large'
  className?: string
}

const iconSize: Record<NonNullable<LogoProps['size']>, string> = {
  small: 'h-[15px]',
  medium: 'h-5',
  large: 'h-7',
}

const wordmarkSize: Record<NonNullable<LogoProps['size']>, string> = {
  small: 'text-base',
  medium: 'text-xl',
  large: 'text-[32px]',
}

export const Logo: FC<LogoProps> = ({ kind = 'wordmark', size = 'medium', className }) => {
  return (
    <span className={cn('inline-flex items-center', className)} role="img" aria-label={PRODUCT_NAME}>
      {kind === 'icon' ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox={BRAND_MARK.viewBox}
          fill="currentColor"
          className={cn('aspect-square w-auto shrink-0 text-foreground', iconSize[size])}
          aria-hidden="true"
        >
          <path d={BRAND_MARK.path} />
        </svg>
      ) : (
        <span
          className={cn(
            'font-logo font-semibold uppercase leading-none tracking-[-0.02em] text-foreground',
            wordmarkSize[size],
          )}
        >
          {PRODUCT_NAME}
        </span>
      )}
    </span>
  )
}
