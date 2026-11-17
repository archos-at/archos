'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useFileDragDrop } from '@/features/documents'
import { FileDropOverlay } from '@/features/documents/components/file-drop-overlay'
import { useTranslations } from '@/i18n'
import { researchCopy } from '@/i18n/namespaces/research'
import { useAppConfig } from '@/shared/context'
import { cn } from '@/lib/utils'
import { UploadDestinationNote } from './UploadDestination'

export interface ChatDropTarget {
  attach: (files: File[]) => void
  refusal: string | null
}

type Register = (target: ChatDropTarget | null) => void

const ChatDropContext = createContext<Register | null>(null)

export function useChatDropTarget(target: ChatDropTarget | null): void {
  const register = useContext(ChatDropContext)
  const attachRef = useRef(target?.attach)
  attachRef.current = target?.attach
  const present = target !== null
  const refusal = target?.refusal ?? null
  useEffect(() => {
    if (!register) return
    if (!present) {
      register(null)
      return
    }
    register({ attach: (files) => attachRef.current?.(files), refusal })
    return () => register(null)
  }, [register, present, refusal])
}

export function ChatDropZone({
  className,
  style,
  children,
}: {
  className?: string
  style?: CSSProperties
  children: ReactNode
}) {
  const t = useTranslations(researchCopy)
  const { fileUpload } = useAppConfig()
  const [target, setTarget] = useState<ChatDropTarget | null>(null)
  const attach = useCallback((files: File[]) => target?.attach(files), [target])
  const { isDragging, isUnsupportedDrag, refusal, dragHandlers } = useFileDragDrop({
    onDrop: attach,
    disabled: target === null,
    refusal: target?.refusal ?? null,
  })

  return (
    <ChatDropContext.Provider value={setTarget}>
      <div className={cn('relative', className)} style={style} {...dragHandlers} data-testid="chat-drop-zone">
        {children}
        <FileDropOverlay
          show={isDragging}
          isUnsupported={isUnsupportedDrag}
          uploadLabel={t('inputArea.dropToUpload')}
          unsupportedLabel={t('inputArea.unsupportedFileType')}
          refusal={refusal}
          hint={
            isUnsupportedDrag ? (
              <span className="text-muted-foreground text-xs">
                {t('inputArea.accepts', { types: fileUpload.acceptedTypes })}
              </span>
            ) : (
              <UploadDestinationNote target="session" />
            )
          }
          testId="chat-drop-overlay"
        />
      </div>
    </ChatDropContext.Provider>
  )
}
