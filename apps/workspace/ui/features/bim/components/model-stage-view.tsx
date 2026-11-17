


import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

import { cn } from '@/lib/utils'
import { documentDisplayName } from '@/lib/documents/display-name'

import type { ModelStageController } from './use-model-stage-controller'
import { ModelStageCanvasLayer, ModelStageChromeLayer } from './model-stage-layers'
import { ModelStageDockLayer } from './model-stage-dock-layer'

export function ModelStageView({ controller }: { controller: ModelStageController }) {
  const { advancedOpen, closeAdvanced, compactSheet, layout, model, onClose, phoneSheet, selectedGlobalId, setPhoneSheet, setView, stageRef, t, viewport } = controller
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        ref={stageRef}
        className={cn(
          'flex h-[100dvh] max-h-[100dvh] w-full max-w-full flex-col gap-0 overflow-hidden rounded-none p-0',
          'pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]',
          layout === 'phone-landscape'
            ? /*
                A phone on its side used to get the desktop window, inset 24 px
                inside a notch that takes 59. Edge to edge instead, the insets
                above doing the rest, and the paper swapped for the canvas's
                colour so the strips beside the notch read as more stage rather
                than as a frame around it.
              */
              'bg-muted sm:h-[100dvh] sm:max-h-[100dvh] sm:w-full sm:max-w-full sm:rounded-none sm:border-0'
            : 'sm:h-[calc(100dvh-3rem)] sm:max-h-[calc(100dvh-3rem)] sm:w-[calc(100vw-3rem)] sm:max-w-[calc(100vw-3rem)] sm:rounded-3xl'
        )}
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          ;(event.currentTarget as HTMLElement | null)?.focus()
        }}
        onEscapeKeyDown={(event) => {
          if (viewport.measure.active) {
            event.preventDefault()
            viewport.measure.setActive(false)
          } else if (advancedOpen) {
            event.preventDefault()
            closeAdvanced()
          } else if (phoneSheet !== null) {
            event.preventDefault()
            setPhoneSheet(null)
          } else if (selectedGlobalId) {
            event.preventDefault()
            setView({ element: undefined })
          }
        }}
      >
        <DialogTitle className="sr-only">
          {model ? t('stage.dialogLabel', { name: documentDisplayName(model) }) : t('title')}
        </DialogTitle>

        <div
          className="group/stage bg-muted relative min-h-0 flex-1"
          data-sheet={layout === 'phone' && compactSheet ? 'open' : undefined}
        >
          <ModelStageCanvasLayer controller={controller} />
          <ModelStageChromeLayer controller={controller} />
          <ModelStageDockLayer controller={controller} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
