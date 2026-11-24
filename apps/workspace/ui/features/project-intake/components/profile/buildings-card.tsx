'use client'

import type { JSX } from 'react'
import { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { BusyButton } from '@/components/ui/busy-button'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { useTranslations } from '@/i18n'
import { intakeProfileStepCopy } from '@/i18n/namespaces/intake-profile-step'
import {
  MAX_BUILDING_NAME_LENGTH,
  MAX_INTAKE_BUILDINGS,
  type BuildingOperation,
  type DerivationReview,
  type IntakeBuilding,
} from '@/lib/project-intake/types'
import { usePressed } from '../../hooks/use-pressed'
import { displayValue } from '../../lib/display'

export type ChangeBuilding = (operation: BuildingOperation) => Promise<string | null>

interface BuildingsCardProps {
  buildings: readonly IntakeBuilding[]
  derivations: readonly DerivationReview[]
  canDecide: boolean
  busy: boolean
  onChangeBuilding: ChangeBuilding
  onAnswer: () => void
}

export function BuildingsCard({ buildings, derivations, canDecide, busy, onChangeBuilding, onAnswer }: BuildingsCardProps): JSX.Element {
  const t = useTranslations(intakeProfileStepCopy)
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<IntakeBuilding | null>(null)
  const [asking, setAsking] = useState(false)
  const [adding, add] = usePressed()
  const removable = canDecide && buildings.length > 1
  return (
    <section
      aria-labelledby="profile-buildings-heading"
      className="bg-card border-border rounded-[14px] border"
      data-testid="profile-buildings"
    >
      <header className="flex flex-col gap-3 px-4 pb-3 pt-4 md:flex-row md:items-start md:justify-between md:gap-6 md:px-[18px]">
        <div className="min-w-0">
          <h2 id="profile-buildings-heading" className="text-base font-medium">
            {t('buildings.heading')}
          </h2>
          <p className="text-muted-foreground mt-0.5 max-w-prose text-[13px]">{t('buildings.description')}</p>
        </div>
        {canDecide && buildings.length < MAX_INTAKE_BUILDINGS && (
          <BusyButton
            type="button"
            variant="secondary"
            size="sm"
            className="touch-target shrink-0 self-start"
            icon={<Plus aria-hidden />}
            busy={adding}
            blocked={busy}
            busyLabel={t('buildings.addBusy')}
            onClick={() => add(async () => setEditing(await onChangeBuilding({ action: 'add' })))}
            data-attr="project-setup-add-building"
          >
            {t('buildings.add')}
          </BusyButton>
        )}
      </header>
      <ul>
        {buildings.map((building) => (
          <BuildingRow
            key={building.id}
            building={building}
            derivation={derivations.find((candidate) => candidate.buildingId === building.id) ?? null}
            editing={editing === building.id}
            canDecide={canDecide}
            busy={busy}
            onEdit={(open) => setEditing(open ? building.id : null)}
            onRename={(name) => onChangeBuilding({ action: 'rename', buildingId: building.id, name })}
            onRemove={
              removable
                ? () => {
                    setRemoving(building)
                    setAsking(true)
                  }
                : undefined
            }
            onAnswer={onAnswer}
          />
        ))}
      </ul>
      <ConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title={t('buildings.removeTitle', { name: removing?.name ?? '' })}
        description={t('buildings.removeDescription')}
        confirmLabel={t('buildings.removeConfirm')}
        cancelLabel={t('buildings.cancel')}
        confirmTestId="profile-building-remove-confirm"
        onConfirm={async () => {
          if (!removing) return
          if (!(await onChangeBuilding({ action: 'remove', buildingId: removing.id }))) throw new Error('not removed')
        }}
      />
    </section>
  )
}

function BuildingFacts({ derivation, onAnswer }: { derivation: DerivationReview | null; onAnswer?: () => void }): JSX.Element | null {
  const t = useTranslations(intakeProfileStepCopy)
  if (!derivation) return null
  const escapeLevel = derivation.inputs.find((input) => input.key.startsWith('escape_level_m@'))
  const open = derivation.value === null && !derivation.highRise
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {escapeLevel && (
        <Badge variant="outline">
          {t('class.reason.escapeLevel', { value: displayValue(escapeLevel.key, escapeLevel.value) })}
        </Badge>
      )}
      {derivation.highRise && <Badge variant="secondary">{t('class.highRise')}</Badge>}
      {derivation.value !== null && <Badge variant="secondary">{t('buildings.class', { value: derivation.value })}</Badge>}
      {open && <span className="text-muted-foreground text-xs">{t('buildings.classOpen')}</span>}
      {open && onAnswer && derivation.missing.length > 0 && (
        <Button type="button" variant="inline" className="touch-target text-[13px]" onClick={onAnswer}>
          {t('class.answer')}
        </Button>
      )}
    </span>
  )
}

interface BuildingRowProps {
  building: IntakeBuilding
  derivation: DerivationReview | null
  editing: boolean
  canDecide: boolean
  busy: boolean
  onEdit: (open: boolean) => void
  onRename: (name: string) => Promise<string | null>
  onRemove?: () => void
  onAnswer: () => void
}

function BuildingRow({ building, derivation, editing, canDecide, busy, onEdit, onRename, onRemove, onAnswer }: BuildingRowProps): JSX.Element {
  const t = useTranslations(intakeProfileStepCopy)
  return (
    <li
      className="border-border/60 flex flex-col gap-2 border-t px-4 py-3 md:min-h-[46px] md:flex-row md:items-center md:gap-3.5 md:px-[18px] md:py-2"
      data-testid={`profile-building-${building.id}`}
    >
      {editing ? (
        <NameForm building={building} busy={busy} onRename={onRename} onClose={() => onEdit(false)} />
      ) : (
        <>
          <span className="min-w-0 truncate text-[15px] font-medium md:w-[200px] md:shrink-0 md:text-sm" title={building.name}>
            {building.name}
          </span>
          <span className="min-w-0 flex-1">
            <BuildingFacts derivation={derivation} onAnswer={canDecide ? onAnswer : undefined} />
          </span>
          {canDecide && (
            <span className="flex shrink-0 items-center gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="text-muted-foreground size-[30px] pointer-coarse:size-11"
                aria-label={t('buildings.renameAria', { name: building.name })}
                title={t('buildings.rename')}
                onClick={() => onEdit(true)}
              >
                <Pencil aria-hidden />
              </Button>
              {onRemove && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground size-[30px] pointer-coarse:size-11"
                  aria-label={t('buildings.removeAria', { name: building.name })}
                  title={t('buildings.remove')}
                  onClick={onRemove}
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </span>
          )}
        </>
      )}
    </li>
  )
}

function NameForm({
  building,
  busy,
  onRename,
  onClose,
}: Pick<BuildingRowProps, 'building' | 'busy' | 'onRename'> & { onClose: () => void }): JSX.Element {
  const t = useTranslations(intakeProfileStepCopy)
  const [name, setName] = useState(building.name)
  const [saving, save] = usePressed()
  const trimmed = name.trim()
  const submit = (): void => {
    if (trimmed === building.name) return onClose()
    save(async () => {
      if (await onRename(trimmed)) onClose()
    })
  }
  return (
    <form
      className="flex w-full flex-col gap-2 md:flex-row md:items-center"
      onSubmit={(event) => {
        event.preventDefault()
        if (trimmed.length > 0 && !busy && !saving) submit()
      }}
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <Input
        autoFocus
        value={name}
        maxLength={MAX_BUILDING_NAME_LENGTH}
        aria-label={t('buildings.nameLabel')}
        className="md:max-w-[320px]"
        onChange={(event) => setName(event.target.value)}
        onFocus={(event) => event.target.select()}
      />
      <span className="flex items-center gap-2">
        <BusyButton type="submit" size="sm" busy={saving} blocked={busy || trimmed.length === 0} busyLabel={t('buildings.saveBusy')}>
          {t('buildings.save')}
        </BusyButton>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t('buildings.cancel')}
        </Button>
      </span>
    </form>
  )
}
