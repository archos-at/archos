import { Chip } from '@/components/ui/chip'
import { AnimatePresence } from '@/components/motion'
import { HeightArrival } from '@/components/motion/height-arrival'
import { FileChip } from './file-chip'
import { UploadDestinationNote } from '../UploadDestination'
import { ComposerSubjectBar } from '@/features/documents/components/composer-subject-bar'
import { ComposerExcerptBar } from '@/features/chat/answer-excerpt'
import { useFilePreviewStore } from '@/features/documents/stores/file-preview-store'
import { dropFileSubject } from '@/features/documents/lib/open-file-peek'
import type { InputAreaController } from './use-input-area-controller'

export function ComposerAboveField({ controller }: { controller: InputAreaController }) {
  return (
    <>
      <ComposerSubjectBar
        subject={controller.composerSubject}
        projectId={controller.projectId}
        onClear={() =>
          dropFileSubject({
            cleared: controller.t('inputArea.subjectCleared'),
            undo: controller.t('inputArea.subjectClearedUndo'),
          })
        }
        onShowFile={
          !controller.fileDockVisible && controller.composerSubject
            ? () => {
                useFilePreviewStore.getState().peek()
              }
            : undefined
        }
        onResolved={controller.handleSubjectResolved}
      />

      <ComposerExcerptBar excerpt={controller.composerExcerpt} onClear={controller.clearComposerExcerpt} />

      {/* Inline file chips — one per attached file, above the textarea.
                Live status dot/spinner, retry on failure, ✕ to remove. */}
      {/* The strip and its destination arrive as one block: attaching the
                first file grew the composer by both in a single frame, so the
                textarea the reader was looking at jumped up. `HeightArrival`
                takes the height on the entrance curve while the chips fade in;
                a thread opened with files already attached stands at once. */}
      <AnimatePresence initial={false}>
        {controller.sessionFiles.length > 0 && (
          <HeightArrival key="session-files" testId="composer-session-files">
            <div
              className="relative mb-2 flex [scrollbar-width:none] gap-1.5 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%_-_24px),transparent)] pb-0.5 [-ms-overflow-style:none] [-webkit-mask-image:linear-gradient(to_right,black_calc(100%_-_24px),transparent)] [&::-webkit-scrollbar]:hidden"
              aria-label={controller.t('inputArea.manageFiles')}
            >
              {controller.sessionFiles.map((file) => (
                <FileChip
                  key={file.id}
                  file={file}
                  onOpen={(opened) => {
                    controller.setPreviewFile(opened)
                    const id = opened.serverFileId ?? opened.id
                    controller.boundSessionUploadRef.current = id
                    controller.setComposerSubject({
                      resourceType: 'document',
                      resourceId: id,
                      title: opened.fileName,
                      filename: opened.fileName,
                      shelf: 'session',
                    })
                  }}
                  onRemove={controller.deleteFile}
                  onRetry={controller.retryFile}
                  readOnly={controller.cannotContribute}
                />
              ))}
            </div>
            <UploadDestinationNote target="session" className="mb-2" />
          </HeightArrival>
        )}
      </AnimatePresence>

      {/* The destination of the chips above — the composer attaches to the
                PRIVATE SESSION and cannot be told otherwise, unlike the sources
                panel, which offers the project corpus as well. Stated in the same
                words the panel uses (shared primitive), so a user who has seen both
                surfaces reads one vocabulary rather than two. */}

      {/* Mobile-only entry to the full manage-files sheet. The desktop
                manage-files button is hidden on phones (the action row stays one
                line), so this compact text link — under the chip strip, only when
                files exist — is the phone user's way to the browse/upload/delete
                list. Not another chip in the action row (keeps it un-bulked). */}
      {/* Not for a viewer, for the same reason the desktop button beside the
                paperclip is disabled for them: what it opens is the browse / upload /
                per-file delete surface. This entry is `sm:hidden`, so leaving it out
                of the gate left the whole write surface reachable on a phone while
                the user guide said it was closed. */}
      {controller.attachedFilesCount > 0 && !controller.cannotContribute && (
        <button data-attr="chat-manage-files-open"
          type="button"
          onClick={() => controller.setManageFilesOpen(true)}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 touch-target mb-2 self-start rounded-sm text-xs font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none sm:hidden"
        >
          {controller.t('inputArea.manageFilesMobile', { count: controller.attachedFilesCount })}
        </button>
      )}

      {/* Text Input */}
      {controller.typingAhead && (
        <span id={controller.typeAheadHintId} className="sr-only">
          {controller.steering
            ? controller.t('inputArea.steerHint')
            : controller.t('inputArea.typeAheadHint')}
        </span>
      )}
      {/* While the reader's own answer runs, Enter steers it: said once,
                small, beside the field, so nobody mistakes the note for a question. */}
      {controller.steering && (
        <Chip
          size="sm"
          variant="outline"
          className="mb-1 self-start"
          title={controller.t('inputArea.steerHint')}
          data-testid="composer-steer-chip"
        >
          {controller.t('inputArea.steerChip')}
        </Chip>
      )}
    </>
  )
}
