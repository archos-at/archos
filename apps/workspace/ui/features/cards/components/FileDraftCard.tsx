'use client'

import { useEffect, useMemo, useRef, useState, type FC } from 'react'
import { Download } from 'lucide-react'
import { AnimatePresence, motion, motionInstant, motionQuick, motionQuickExit } from '@/components/motion'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FittedName } from '@/components/ui/fitted-name'
import { SectionLabel } from '@/components/ui/section-label'
import { StackedLabel } from '@/components/ui/stacked-label'
import { AuthorshipLine } from '@/features/documents/chat-card-parts'
import { useChatStore } from '@/features/chat/store'
import { useIsMobile } from '@/hooks/use-is-mobile'
import { useReducedMotion } from '@/hooks/use-reduced-motion'
import { useLocale, useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import { draftFileName, draftFileType } from '@/lib/conversations/draft-media'
import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useDraftFiling, type DraftFiling } from '../hooks/use-draft-filing'
import { useDraftLife } from '../hooks/use-draft-life'
import { draftFileUrls, type DraftFileUrls } from '../lib/document-draft-preview'
import { CARD_SHELL, DECISION_BUTTON, DECISION_ROW } from './card-chrome'
import {
  DraftConflictNotice,
  DraftMenu,
  DraftSaveDialog,
  ProjectChangeNotice,
  openFiled,
  openFiledInPlace,
} from './draft-filing-parts'
import { FileDraftThumbnail } from './FileDraftThumbnail'
import { FileDraftViewer } from './FileDraftViewer'

export interface FileDraftCardProps {
  title: string
  path: string
  bytes: number
  version: number
  documentId?: string | null
  versionId?: string | null
  versionState?: DocumentVersionState | null
  filedDraftVersion?: number | null
  derivedFromDocumentId?: string | null
  derivedFromName?: string | null
  removed?: boolean | null
  messageId?: string
  cardKey: string
  decisionsMustPersist?: boolean
  urls?: DraftFileUrls
}

function askForExcel(prompt: string): void {
  useChatStore.getState().setComposerPrefill(prompt)
}

const FILE_ROW = 'grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end'

const FILE_BUTTON = 'max-sm:h-11 max-sm:w-full'

const FILE_WIDE_BUTTON = cn(FILE_BUTTON, 'max-sm:col-span-2')

const FiledActions: FC<{ filing: DraftFiling }> = ({ filing }) => {
  const t = useTranslations(chatCopy)
  const isMobile = useIsMobile()
  const { href, shownDocumentId, projectId, isFiling } = filing
  return (
    <div className={DECISION_ROW}>
      {href && shownDocumentId && projectId && (
        <Button asChild variant="secondary" size="sm" className={DECISION_BUTTON}>
          <a
            href={href}
            data-testid="document-draft-open"
            onClick={(event) => openFiledInPlace(event, { documentId: shownDocumentId, projectId, href, isMobile })}
          >
            {t('cards.documentDraft.open')}
          </a>
        </Button>
      )}
      {filing.canUpdate && (
        <Button
          size="sm"
          className={DECISION_BUTTON}
          aria-disabled={isFiling || undefined}
          aria-busy={isFiling || undefined}
          onClick={() => void filing.update()}
          data-testid="file-draft-update"
        >
          <StackedLabel
            busy={isFiling}
            idle={t('cards.fileDraft.updateInProject')}
            working={t('cards.fileDraft.updating')}
          />
        </Button>
      )}
    </div>
  )
}

const RemovedDraft: FC<{ name: string; format: string; filing: DraftFiling; focus: boolean }> = ({
  name,
  format,
  filing,
  focus,
}) => {
  const t = useTranslations(chatCopy)
  const isMobile = useIsMobile()
  const shell = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focus) shell.current?.focus()
  }, [focus])
  const { href, shownDocumentId, projectId, shownFiled } = filing
  return (
    <Card
      ref={shell}
      tabIndex={-1}
      data-testid="file-draft-card"
      data-removed="true"
      role="group"
      aria-label={`${format}: ${name}`}
      className={cn(CARD_SHELL, 'gap-1 p-4 outline-none sm:p-5')}
    >
      <SectionLabel>{t('cards.fileDraft.removed')}</SectionLabel>
      <FittedName text={name} lines={2} className="card-title text-muted-foreground" />
      <p className="card-caption text-muted-foreground" data-testid="file-draft-removed">
        {t('cards.fileDraft.removedNote')}
        {shownFiled && ` ${t('cards.fileDraft.removedFiled')}`}
      </p>
      {shownFiled && href && shownDocumentId && projectId && (
        <div className={DECISION_ROW}>
          <Button asChild variant="secondary" size="sm" className={DECISION_BUTTON}>
            <a
              href={href}
              data-testid="document-draft-open"
              onClick={(event) => openFiledInPlace(event, { documentId: shownDocumentId, projectId, href, isMobile })}
            >
              {t('cards.documentDraft.open')}
            </a>
          </Button>
        </div>
      )}
    </Card>
  )
}

export const FileDraftCard: FC<FileDraftCardProps> = (props) => {
  const { title, path, bytes, version } = props
  const t = useTranslations(chatCopy)
  const { locale } = useLocale()
  const reduced = useReducedMotion()
  const isMobile = useIsMobile()
  const filing = useDraftFiling(props)
  const life = useDraftLife(props)
  const { conversationId, shownFiled, isFiling } = filing
  const [viewerOpen, setViewerOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [savingOwn, setSavingOwn] = useState(false)
  const [justRemoved, setJustRemoved] = useState(false)
  const type = useMemo(() => draftFileType(path), [path])
  const name = draftFileName(path) || title
  const urls = props.urls ?? (conversationId ? draftFileUrls(conversationId, path, version) : null)
  const refused = type.filing === 'refused'
  const format = t(`cards.fileDraft.format.${type.format}` as 'cards.fileDraft.format.word')
  const stateLabel = filing.stateLabel
  const facts = [type.extension.toUpperCase() || format, formatBytes(bytes, locale)]
  if (version > 1) facts.push(t('cards.documentDraft.version', { version }))
  const source =
    props.derivedFromDocumentId && props.derivedFromName
      ? { documentId: props.derivedFromDocumentId, name: props.derivedFromName }
      : null

  if (life.removed) return <RemovedDraft name={name} format={format} filing={filing} focus={justRemoved} />

  const openSave = (own: boolean) => {
    setSavingOwn(own)
    setSaveOpen(true)
  }

  const openFile = () => {
    if (life.superseded) return
    if (shownFiled) {
      if (filing.href && filing.shownDocumentId && filing.projectId) {
        openFiled({ documentId: filing.shownDocumentId, projectId: filing.projectId, href: filing.href, isMobile })
      }
      return
    }
    if (urls) setViewerOpen(true)
  }

  return (
    <Card
      data-testid="file-draft-card"
      data-format={type.format}
      role="group"
      aria-label={`${format}: ${name}`}
      className={cn(CARD_SHELL, 'relative gap-3 p-4 sm:p-5')}
    >
      <DraftMenu
        life={life}
        name={name}
        filed={shownFiled}
        onRemoved={() => setJustRemoved(true)}
        className="absolute right-2 top-2"
      />
      <div className="flex min-w-0 gap-4 pr-8">
        <FileDraftThumbnail
          type={type}
          name={name}
          urls={shownFiled || life.superseded ? null : urls}
          onOpen={openFile}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <SectionLabel>{shownFiled ? t('cards.fileDraft.eyebrowFiled') : t('cards.fileDraft.eyebrow')}</SectionLabel>
          <FittedName text={title} lines={2} className="card-title text-foreground" />
          <p className="card-caption tabular-nums text-muted-foreground" data-testid="file-draft-facts">
            <span className="sr-only">{format}, </span>
            {facts.join(' · ')}
          </p>
          <AuthorshipLine authoredBy="agent" />
          <p className="card-caption text-muted-foreground" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              {life.superseded ? (
                <span data-testid="file-draft-superseded">{t('cards.fileDraft.superseded')}</span>
              ) : filing.filedKnown ? (
                <motion.span
                  key={stateLabel}
                  className="inline-block"
                  data-testid="document-draft-state"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: reduced ? motionInstant : motionQuick }}
                  exit={{ opacity: 0, transition: reduced ? motionInstant : motionQuickExit }}
                >
                  {stateLabel}
                </motion.span>
              ) : refused ? (
                <span data-testid="file-draft-refusal">
                  {type.format === 'csv' ? t('cards.fileDraft.csvNotFileable') : t('cards.fileDraft.notFileable')}
                </span>
              ) : null}
            </AnimatePresence>
          </p>
        </div>
      </div>

      {life.superseded ? null : shownFiled ? (
        <FiledActions filing={filing} />
      ) : (
        urls && (
          <div className={FILE_ROW}>
            <Button variant="secondary" size="sm" className={FILE_BUTTON} onClick={() => setViewerOpen(true)}>
              {t('cards.fileDraft.open')}
            </Button>
            <Button asChild variant="secondary" size="sm" className={FILE_BUTTON}>
              <a href={urls.download} download={name} aria-label={t('cards.fileDraft.downloadName', { name })}>
                <Download aria-hidden />
                {t('cards.fileDraft.download')}
              </a>
            </Button>
            {refused && type.format === 'csv' && (
              <Button
                variant="secondary"
                size="sm"
                className={FILE_WIDE_BUTTON}
                onClick={() =>
                  askForExcel(t('cards.fileDraft.askForExcelPrompt', { name: name.replace(/\.[^.]+$/, '') }))
                }
              >
                {t('cards.fileDraft.askForExcel')}
              </Button>
            )}
            {filing.canFile && !refused && (
              <Button
                size="sm"
                className={FILE_WIDE_BUTTON}
                aria-disabled={isFiling || undefined}
                aria-busy={isFiling || undefined}
                onClick={() => (filing.projectId ? openSave(false) : void filing.file(false))}
                data-testid="file-draft-file"
              >
                <StackedLabel
                  busy={isFiling}
                  idle={t('cards.documentDraft.file')}
                  working={t('cards.documentDraft.filing')}
                />
              </Button>
            )}
          </div>
        )
      )}


      {filing.error && !saveOpen && (
        <p className="card-caption text-destructive" role="alert" data-testid="document-draft-error">
          {filing.error}
        </p>
      )}

      <DraftConflictNotice filing={filing} />
      <ProjectChangeNotice filing={filing} name={name} onFileAsOwn={() => openSave(true)} />

      {(filing.canFile || filing.projectChange) && !refused && (
        <DraftSaveDialog
          filing={filing}
          open={saveOpen}
          onOpenChange={setSaveOpen}
          title={title}
          path={path}
          source={savingOwn ? null : source}
          asOwn={savingOwn}
        />
      )}

      {!shownFiled && !life.superseded && conversationId && urls && (
        <FileDraftViewer
          open={viewerOpen}
          onClose={() => setViewerOpen(false)}
          type={type}
          name={name}
          title={title}
          path={path}
          version={version}
          bytes={bytes}
          conversationId={conversationId}
          urls={urls}
        />
      )}
    </Card>
  )
}
