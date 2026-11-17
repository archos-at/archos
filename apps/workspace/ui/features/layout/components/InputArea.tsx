'use client'

import { type FC, memo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'

import { FIELD_FOCUS_WITHIN_RING } from '@/components/ui/focus-ring'
import { cn } from '@/lib/utils'
import { THREAD_COLUMN, THREAD_GUTTER } from '@/components/ui/thread-column'
import { FileSourcesTab } from './FileSourcesTab'
import { trackedFileToFileItem } from '@/features/documents/types'
import { FilePreviewDialog } from '@/features/documents/components/file-preview-dialog'
import { MentionPicker } from '@/features/collaboration/components/MentionPicker'
import { SlashCommandPicker } from '@/features/skills/components/SlashCommandPicker'
import { ComposerSearchPicker } from '@/features/search'
import { useInputAreaController } from './input-area/use-input-area-controller'
import type { InputAreaProps } from './input-area/use-input-area-controller'
import { ComposerAboveField } from './input-area/composer-above-field'
import { ComposerField } from './input-area/composer-field'
import { ComposerControls } from './input-area/composer-controls'

export type { ConnectionMode } from './input-area/use-input-area-controller'

export const InputArea: FC<InputAreaProps> = memo(function InputArea(props) {
  const controller = useInputAreaController(props)

  return (
    <div
      ref={controller.composerRootRef}
      className={cn(
        THREAD_COLUMN,
        THREAD_GUTTER,
        'flex flex-col pt-3 pb-[max(0.75rem,var(--shell-inset-bottom,env(safe-area-inset-bottom)))] sm:pt-4 sm:pb-4'
      )}
    >
      {/* The mention picker is anchored to the composer CARD and opens above it,
          spanning its full width — the Slack/Linear placement. Caret-pixel tracking
          inside a textarea is fragile and buys nothing here. */}
      <Popover
        open={controller.mentionPickerOpen || controller.slash.open || controller.reference.open}
        onOpenChange={(open) => {
          if (open) return
          controller.setMentionDismissed(true)
          controller.slash.dismiss()
          controller.reference.dismiss()
        }}
      >
        <PopoverAnchor asChild>
          <div
            ref={controller.composerRef}
            className={cn(
              '@container bg-card/90 supports-[backdrop-filter]:bg-card/85 relative flex flex-col rounded-xl px-3 py-2.5 shadow-md backdrop-blur-md sm:px-4',
              FIELD_FOCUS_WITHIN_RING,
              controller.isDisabledByAuth && 'opacity-60'
            )}
          >
            <ComposerAboveField controller={controller} />
            <ComposerField controller={controller} />
            <ComposerControls controller={controller} />

            {/* Single hint slot: the first applicable helper line, announced
                politely. The Deep-Research intent echo was deleted — the pill's
                title carries it — so an armed pill shows no line at all. */}
            <div aria-live="polite">{controller.composerHint}</div>
          </div>
        </PopoverAnchor>

        {/* The panel itself supplies the surface, so the popover contributes
            nothing but placement and width. Focus must NOT move here: the user is
            typing, and the textarea forwards the navigation keys. */}
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-[var(--radix-popover-trigger-width)] border-0 bg-transparent p-0 shadow-none"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onFocusOutside={(event) => event.preventDefault()}
          onPointerDown={(event) => event.preventDefault()}
          onMouseDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            const target = event.target as Node | null
            if (target && controller.composerRef.current?.contains(target)) event.preventDefault()
          }}
        >
          {controller.reference.open ? (
            <ComposerSearchPicker
              ref={controller.reference.pickerRef}
              query={controller.reference.query}
              search={controller.reference.search}
              onPick={controller.reference.select}
              onAriaChange={controller.reference.onAriaChange}
            />
          ) : controller.slash.open ? (
            <SlashCommandPicker
              ref={controller.slash.pickerRef}
              query={controller.slash.query}
              skills={controller.slash.skills}
              loading={controller.slash.loading}
              onSelect={controller.slash.select}
              onAriaChange={controller.slash.onAriaChange}
            />
          ) : (
            <MentionPicker
              ref={controller.mentionPickerRef}
              query={controller.mentionQuery?.query ?? ''}
              candidates={controller.mentionData?.candidates ?? []}
              canInvite={controller.mentionData?.canInvite ?? false}
              loading={controller.mentionsLoading}
              onSelect={controller.handleMentionSelect}
              onAriaChange={controller.setMentionAria}
            />
          )}
        </PopoverContent>
      </Popover>

      {/* AI-transparency disclosure (EU AI Act Art. 50): users must know they
          interact with an AI system and that answers can be wrong. Kept to a
          single compact line so it costs minimal vertical space on both mobile
          and desktop, while staying persistently visible, legible and not
          hidden behind a click, per the Art. 50(5) "clear and distinguishable"
          standard. That standard is carried by the SENTENCE, which is
          unabridged, always rendered and never collapsed; it used to be led by
          a spark glyph as well, and the glyph was reinforcement rather than the
          disclosure. The composer floats over the scrolling chat, so a light
          blurred pill keeps it readable over messages behind it. */}
      <div className="mt-1.5 flex justify-center">
        {/* Frosted, not hand-derived: this hint sits ON the transcript, and the
            alpha pair is what `backdrop-blur-sm` has to blur (the `supports-`
            step is the no-blur fallback). */}
        <p className="text-muted-foreground bg-muted/70 supports-[backdrop-filter]:bg-muted/45 inline-flex max-w-[calc(100%-1rem)] items-center rounded-lg px-2.5 py-1 text-center text-xs leading-snug backdrop-blur-sm">
          {controller.t('inputArea.aiDisclosure')}
        </p>
      </div>

      {/* Manage-files dialog — one controlled instance shared by the desktop
          button and the mobile text entry. Mobile: a bottom sheet that slides up
          (85dvh, rounded top, safe-area padding). Desktop (sm+): the standard
          centered dialog. The FileSourcesTab inside is the full browse / upload /
          per-file open+delete surface. */}
      <Dialog open={controller.manageFilesOpen} onOpenChange={controller.setManageFilesOpen}>
        <DialogContent
          className={cn(
            'flex max-w-full flex-col gap-0 rounded-t-2xl rounded-b-none p-0',
            'top-auto bottom-0 left-0 translate-x-0 translate-y-0',
            'h-[85dvh] max-h-[85dvh]',
            'sm:top-[50%] sm:bottom-auto sm:left-[50%] sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-3xl sm:p-6'
          )}
        >
          <DialogHeader className="border-b px-4 py-3 text-left sm:border-0 sm:p-0">
            <DialogTitle>{controller.t('inputArea.manageFiles')}</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-0 sm:pt-2 sm:pb-0">
            <FileSourcesTab />
          </div>
        </DialogContent>
      </Dialog>

      {/* Read-only preview of an attached file, opened from a successful chip.
          Read-only (canManage=false): the composer is not a management surface —
          that is what the manage-files dialog above is for. */}
      <FilePreviewDialog
        file={controller.previewFile ? trackedFileToFileItem(controller.previewFile) : null}
        canManage={false}
        onClose={() => controller.setPreviewFile(null)}
      />
    </div>
  )
})
