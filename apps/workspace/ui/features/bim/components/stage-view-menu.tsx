'use client'

import type { JSX } from 'react'
import { Video } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import { BIM_CAMERA_VIEWS, type BimCameraView } from '../lib/viewer-camera'
import { ViewerIconButtonBase, ViewerToolButton } from './viewer'

export function StageViewMenu({
  view,
  orthographic,
  onViewChange,
  onOrthographicChange,
  disabled,
  trigger = 'icon',
  side = 'top',
}: {
  view: BimCameraView
  orthographic: boolean
  onViewChange: (view: BimCameraView) => void
  onOrthographicChange: (orthographic: boolean) => void
  disabled: boolean
  trigger?: 'icon' | 'tool'
  side?: 'top' | 'right'
}): JSX.Element {
  const t = useTranslations(bimCopy)

  return (
    <DropdownMenu>
      {/*
        The trigger is the BUTTON, not a wrapper around it. A `<span>` in
        between takes Radix's props — including the ones that make Enter open
        the menu — and leaves the focused button inert, which is a control that
        works with a mouse and not with a keyboard.
      */}
      {trigger === 'tool' ? (
        <DropdownMenuTrigger asChild>
          <ViewerToolButton
            label={
              view === 'iso' ? t('stage.views') : `${t('stage.views')}: ${t(`viewer.view.${view}`)}`
            }
            caption={view === 'iso' ? t('stage.views') : t(`viewer.view.${view}`)}
            icon={Video}
            disabled={disabled}
            active={view !== 'iso'}
          />
        </DropdownMenuTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              {/*
                The name of the active view, on the trigger. Section, Measure and
                See-through all light up when they are on; this one looked
                identical whether the reader was on the north elevation in
                parallel projection or in the free perspective default, so the
                only way to find out was to open the menu and read it. The
                `adornment` prop exists for exactly this and had no caller.
              */}
              <ViewerIconButtonBase
                label={t('stage.views')}
                icon={Video}
                disabled={disabled}
                active={view !== 'iso'}
                adornment={
                  view === 'iso' ? undefined : (
                    <span className="text-xs font-medium">{t(`viewer.view.${view}`)}</span>
                  )
                }
              />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={8}>
            {t('stage.views')}
          </TooltipContent>
        </Tooltip>
      )}
      <DropdownMenuContent
        side={side}
        sideOffset={10}
        align={side === 'top' ? 'start' : 'center'}
        className="w-44"
        aria-label={t('stage.views')}
      >
        <DropdownMenuRadioGroup
          value={view}
          onValueChange={(next) => onViewChange(next as BimCameraView)}
        >
          {BIM_CAMERA_VIEWS.map((candidate) => (
            <DropdownMenuRadioItem key={candidate} value={candidate}>
              {t(`viewer.view.${candidate}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={orthographic}
          onCheckedChange={(checked) => onOrthographicChange(checked === true)}
          onSelect={(event) => event.preventDefault()}
        >
          {t('viewer.projection.parallel')}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
