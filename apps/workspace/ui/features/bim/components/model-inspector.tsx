'use client'

import type { JSX } from 'react'
import Link from 'next/link'
import { EyeOff, MessageSquarePlus, Scan } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useLocale, useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import { elementQuestionHref } from '../lib/element-question'
import { formatPropertyValue } from '../lib/format-value'
import { humaniseIfcType } from '../lib/stage-model'
import type { BimElementDetail } from '../hooks/use-bim-model'
import { CopyableValue } from '@/components/ui/copyable-value'
import {
  ViewerField,
  ViewerFieldGroup,
  ViewerPanel,
  ViewerSheet,
  type ViewerSheetCollapse,
} from './viewer'

export interface ModelInspectorProps {
  element: BimElementDetail | null
  isLoading: boolean
  error: string | null
  projectId: string | null
  modelFilename: string | null
  onClose: () => void
  onHide?: () => void
  onIsolate?: () => void
  isolated?: boolean
  sheet?: { placement: 'bottom' | 'side'; collapse: ViewerSheetCollapse }
  className?: string
}

export function ModelInspector({
  element,
  isLoading,
  error,
  projectId,
  modelFilename,
  onClose,
  onHide,
  onIsolate,
  isolated = false,
  sheet,
  className,
}: ModelInspectorProps): JSX.Element {
  const t = useTranslations(bimCopy)
  const { locale } = useLocale()

  const missing = !isLoading && !error && !element
  const title =
    element?.name?.trim() ||
    (element
      ? humaniseIfcType(element.ifcType)
      : t(missing ? 'element.notFound' : 'stage.selection.loading'))

  const subtitle = element
    ? [humaniseIfcType(element.ifcType), element.storeyName].filter(Boolean).join(' · ')
    : undefined

  const footer = element && (
    <div className="space-y-1">
      {/*
              Two verbs, and they are different verbs: hiding takes THIS out
              of the way, isolating takes everything else. Side by side
              because the reader is choosing between them, not working down a
              list.

              Only one of them is a toggle. Hiding removes the card it is
              pressed from, so there is never a hide button in a "pressed"
              state to look at; isolating leaves both the element and its card
              exactly where they were, so its button has two states and has to
              show which one it is in. Same filled ink as the dock's toggles.
            */}
      {(onHide || onIsolate) && (
        <div className="flex gap-1">
          {onIsolate && (
            <Button
              aria-pressed={isolated}
              variant={isolated ? 'default' : 'ghost'}
              size="sm"
              className="flex-1 justify-start gap-2"
              onClick={onIsolate}
            >
              <Scan className="size-4" aria-hidden="true" />
              {t('stage.selection.isolate')}
            </Button>
          )}
          {onHide && (
            <Button
              variant="ghost"
              size="sm"
              className="flex-1 justify-start gap-2"
              onClick={onHide}
            >
              <EyeOff className="size-4" aria-hidden="true" />
              {t('stage.selection.hide')}
            </Button>
          )}
        </div>
      )}
      {projectId && (
        <Button asChild variant="ghost" size="sm" className="w-full justify-start gap-2">
          <Link
            href={elementQuestionHref(
              projectId,
              {
                globalId: element.globalId,
                ifcType: element.ifcType,
                name: element.name,
                storeyName: element.storeyName,
              },
              { modelFilename }
            )}
          >
            <MessageSquarePlus className="size-4" aria-hidden="true" />
            {t('stage.selection.ask')}
          </Link>
        </Button>
      )}
    </div>
  )
  const body = (
    <>
      {error && <p className="text-destructive text-xs">{t('properties.loadFailed')}</p>}

      {!error && !element && (
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          {isLoading && <Spinner className="size-3" />}
          {isLoading ? t('stage.selection.loading') : t('element.notFound')}
        </div>
      )}

      {element && (
        <>
          <ViewerFieldGroup label={t('stage.selection.about')}>
            <ViewerField label={t('properties.ifcType')}>
              {humaniseIfcType(element.ifcType)}
            </ViewerField>
            {element.storeyName && (
              <ViewerField label={t('properties.storey')}>{element.storeyName}</ViewerField>
            )}
            {element.tag && <ViewerField label={t('properties.tag')}>{element.tag}</ViewerField>}
            {element.materials.length > 0 && (
              <ViewerField label={t('properties.materials')}>
                {element.materials.join(', ')}
              </ViewerField>
            )}
          </ViewerFieldGroup>

          {/*
            Quantities are the one part of a schema an architect reads
            unprompted — an area, a volume, a length. They stay above the fold
            for that reason, while the property sets that describe HOW the
            exporter modelled the thing go below it.
          */}
          {Object.entries(element.quantities).map(([setName, quantities]) => (
            <ViewerFieldGroup key={setName} label={setName}>
              {Object.entries(quantities).map(([name, value]) => (
                <ViewerField key={name} label={name}>
                  <span className="tabular-nums">
                    {(Math.round(value * 1000) / 1000).toLocaleString(locale)}
                  </span>
                </ViewerField>
              ))}
            </ViewerFieldGroup>
          ))}

          <ModelInspectorDetails
            element={element}
            locale={locale}
            label={t('stage.selection.technical')}
          />
        </>
      )}
    </>
  )

  if (sheet) {
    return (
      <ViewerSheet
        placement={sheet.placement}
        collapse={sheet.collapse}
        title={title}
        subtitle={subtitle}
        closeLabel={t('stage.selection.close')}
        onClose={onClose}
        className={className}
        footer={footer}
      >
        {body}
      </ViewerSheet>
    )
  }
  return (
    <ViewerPanel
      title={title}
      subtitle={subtitle}
      closeLabel={t('stage.selection.close')}
      onClose={onClose}
      className={className}
      footer={footer}
    >
      {body}
    </ViewerPanel>
  )
}

function ModelInspectorDetails({
  element,
  locale,
  label,
}: {
  element: BimElementDetail
  locale: string
  label: string
}): JSX.Element {
  const t = useTranslations(bimCopy)
  const propertySets = Object.entries(element.properties)

  return (
    <details className="border-border mt-3 border-t pt-2">
      {/*
        `pointer-coarse:min-h-11`: an 11 px line of text was the entire hit
        area, and behind it sit the GlobalId, the classifications and every
        property set — everything this card deliberately folds away. On a phone
        that is a door the size of its own label.

        Grown with padding rather than `min-h` and a flex centre: changing a
        `<summary>`'s display has a history of costing it its toggle in Safari,
        and padding needs no display change at all.
      */}
      <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/60 pointer-coarse:min-h-11 pointer-coarse:py-3.5 duration-quick cursor-pointer rounded text-xs font-medium outline-none transition-colors ease-out marker:content-none focus-visible:ring-2">
        {label}
      </summary>

      <div className="mt-2">
        <ViewerFieldGroup label={t('properties.identity')}>
          <ViewerField label={t('properties.globalId')}>
            {/*
              Wrapped AND copyable. At 393 px a 22-character id used to end in
              an ellipsis whose full text lived in a `title`, which a finger
              cannot raise. The id is what an architect pastes into a BCF topic
              or a mail to the structural engineer, so the useful act is a tap
              that copies it, not a longer label.
            */}
            <CopyableValue value={element.globalId} className="font-mono" />
          </ViewerField>
          {element.predefinedType && (
            <ViewerField label={t('properties.predefinedType')}>
              {element.predefinedType}
            </ViewerField>
          )}
          {element.typeName && (
            <ViewerField label={t('properties.typeName')}>{element.typeName}</ViewerField>
          )}
        </ViewerFieldGroup>

        {element.classifications.length > 0 && (
          <ViewerFieldGroup label={t('properties.classifications')}>
            {element.classifications.map((classification) => (
              <ViewerField
                key={`${classification.system}-${classification.identification}`}
                label={classification.system ?? '—'}
              >
                {[classification.identification, classification.name].filter(Boolean).join(' ') ||
                  '—'}
              </ViewerField>
            ))}
          </ViewerFieldGroup>
        )}

        {propertySets.map(([setName, properties]) => (
          <ViewerFieldGroup key={setName} label={setName}>
            {Object.entries(properties).map(([name, value]) => (
              <ViewerField key={name} label={name}>
                {formatPropertyValue(value, locale)}
              </ViewerField>
            ))}
          </ViewerFieldGroup>
        ))}
      </div>
    </details>
  )
}
