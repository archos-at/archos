'use client'

import type { FC } from 'react'

import { AnimatePresence, motion, motionInstant, motionQuick } from '@/components/motion'
import { AuthorityTag } from '@/features/chat/components/AuthorityTag'
import { SourceSignalChip } from '@/features/layout/components/SourceSignalChip'
import { useTranslations } from '@/i18n'
import { runsCopy } from '@/i18n/namespaces/runs'
import type { RunLedgerDoc } from '@/lib/runs/run-ledger-types'
import { cn } from '@/lib/utils'
import { docProvenance } from '../../lib/doc-provenance'

export const DocChip: FC<{ doc: RunLedgerDoc; reduced: boolean }> = ({ doc, reduced }) => {
  const t = useTranslations(runsCopy)
  const { tint, authority } = docProvenance(doc)
  const name = doc.title ?? doc.name
  const loci = doc.loci.join(' · ')
  return (
    <SourceSignalChip
      signal={tint}
      className={cn(
        'duration-quick max-w-full transition-opacity ease-out motion-reduce:transition-none',
        WRAPPING_CHIP,
        doc.repeat && 'opacity-75'
      )}
      title={loci ? `${name} · ${loci}` : name}
    >
      {authority && (
        <>
          <AuthorityTag>{authority}</AuthorityTag>{' '}
        </>
      )}
      {name}
      {loci && <span className="opacity-70"> · {loci}</span>}
      {/* A mark that lands on a chip already on screen crossfades in; one the
          chip mounted with is simply there. */}
      <AnimatePresence initial={false}>
        {doc.repeat && (
          <motion.span
            key="repeat"
            className="italic"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.7 }}
            exit={{ opacity: 0 }}
            transition={reduced ? motionInstant : motionQuick}
          >
            {' · '}
            {t('step.repeat')}
          </motion.span>
        )}
      </AnimatePresence>
    </SourceSignalChip>
  )
}

export const WRAPPING_CHIP =
  'h-auto min-h-6 items-start overflow-visible! whitespace-normal! text-clip! rounded-xl py-0.5 text-left ' +
  '[&>svg]:mt-[3px] [&>span]:overflow-visible! [&>span]:whitespace-normal! [&>span]:text-clip! [&>span]:[overflow-wrap:anywhere]'
