'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import { humanizeTerm, type DrawingStructured } from '@/lib/documents/drawing-structured'

export function DrawingStructuredDetails({ structured }: { structured: DrawingStructured }) {
  const t = useTranslations(filesCopy)
  const [open, setOpen] = useState(false)
  const { segment, document } = structured

  const term = (group: string, key: string) => {
    const path = `preview.visualDetails.structured.${group}.${key}`
    const translated = t(path)
    return translated.endsWith(path) ? humanizeTerm(key) : translated
  }

  return (
    <div className="mt-1.5">
      <button data-attr="files-open"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="touch-target text-muted-foreground duration-snap hover:text-foreground flex items-center gap-1 text-[11px] font-medium transition-colors ease-out motion-reduce:transition-none"
      >
        {t('preview.visualDetails.structured.toggle')}
        <ChevronDown
          className={cn(
            'duration-quick size-3 shrink-0 transition-transform ease-out motion-reduce:transition-none',
            open && 'rotate-180'
          )}
          aria-hidden
        />
      </button>

      {open && (
        <dl className="mt-1.5 space-y-1 pl-2.5 text-[11px] leading-relaxed">
          {segment.entityGroups.map((group) => (
            <Row key={group.category} label={term('categories', group.category)}>
              {group.entities
                .map((entity) => {
                  const extras = [entity.role, entity.measure].filter(Boolean).join(', ')
                  return extras ? `${entity.name} (${extras})` : entity.name
                })
                .join(' · ')}
            </Row>
          ))}

          {segment.compositions.map((composition, index) => (
            <Row
              key={`${composition.component}-${index}`}
              label={t('preview.visualDetails.structured.composition', {
                component: composition.component,
              })}
            >
              {composition.layers
                .map((layer) =>
                  [layer.material, layer.thickness, layer.purpose && `(${layer.purpose})`]
                    .filter(Boolean)
                    .join(' ')
                )
                .join(' | ')}
            </Row>
          ))}

          {segment.states.length > 0 && (
            <Row label={t('preview.visualDetails.structured.states')}>
              {segment.states
                .map((entry) => `${entry.element}: ${term('state', entry.state)}`)
                .join(' · ')}
            </Row>
          )}

          {segment.quantities.map((quantity, index) => (
            <Row
              key={`${quantity.object}-${index}`}
              label={`${quantity.object} — ${quantity.property}`}
            >
              {[quantity.value, quantity.unit].filter(Boolean).join(' ')}
            </Row>
          ))}

          {segment.relations.length > 0 && (
            <Row label={t('preview.visualDetails.structured.relations')}>
              {segment.relations
                .map((r) => `${r.subject} → ${r.relation} → ${r.object}`)
                .join(' · ')}
            </Row>
          )}

          {segment.annotations.length > 0 && (
            <Row label={t('preview.visualDetails.structured.annotations')}>
              {segment.annotations.join(' · ')}
            </Row>
          )}

          <DocumentRows document={document} />

          {(segment.source || segment.confidence) && (
            <Row label={t('preview.visualDetails.structured.provenance')}>
              {[
                segment.source && term('source', segment.source),
                segment.confidence &&
                  t('preview.visualDetails.structured.confidenceValue', {
                    level: term('confidence', segment.confidence),
                  }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </Row>
          )}
        </dl>
      )}
    </div>
  )
}

function DocumentRows({ document }: { document: DrawingStructured['document'] }) {
  const t = useTranslations(filesCopy)
  const credits = [document.author, document.institution, document.supervision, document.location]
    .filter(Boolean)
    .join(', ')

  return (
    <>
      {document.title && (
        <Row label={t('preview.visualDetails.structured.project')}>
          {[document.title, document.subtitle].filter(Boolean).join(' — ')}
        </Row>
      )}
      {credits && <Row label={t('preview.visualDetails.structured.credits')}>{credits}</Row>}
      {document.slogans.length > 0 && (
        <Row label={t('preview.visualDetails.structured.slogans')}>
          {document.slogans.join(' · ')}
        </Row>
      )}
      {document.strategies.length > 0 && (
        <Row label={t('preview.visualDetails.structured.strategies')}>
          {document.strategies.join(' · ')}
        </Row>
      )}
      {document.processSteps.length > 0 && (
        <Row label={t('preview.visualDetails.structured.processSteps')}>
          {document.processSteps.join(' → ')}
        </Row>
      )}
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-foreground/90 min-w-0">{children}</dd>
    </div>
  )
}
