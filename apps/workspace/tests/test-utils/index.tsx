import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'

const TestProviders = ({ children }: { children: React.ReactNode }) => (
  <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
)

const renderWithProviders = (ui: ReactElement) => {
  const { rerender, ...rest } = render(<TestProviders>{ui}</TestProviders>)
  return {
    ...rest,
    rerender: (rerenderUi: ReactElement) => rerender(<TestProviders>{rerenderUi}</TestProviders>),
  }
}

export * from '@testing-library/react'
export { renderWithProviders as render }
