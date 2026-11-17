'use client'

import type { JSX } from 'react'
import {
  Camera,
  Eye,
  Home,
  Layers,
  Layers3,
  MonitorX,
  MoreHorizontal,
  Ruler,
  Scissors,
  SlidersHorizontal,
  Undo2,
} from 'lucide-react'
import { useTranslations } from '@/i18n'
import { bimCopy } from '@/i18n/namespaces/bim'
import type { BimCameraView } from '../lib/viewer-camera'
import { StageViewMenu } from './stage-view-menu'
import { ViewerRailItem, ViewerToolButton } from './viewer'

export type PhoneSheet = 'levels' | 'more'

export interface PhoneToolsProps {
  placement: 'bar' | 'side'
  ready: boolean
  onFit: () => void
  cameraView: BimCameraView
  orthographic: boolean
  onViewChange: (view: BimCameraView) => void
  onOrthographicChange: (orthographic: boolean) => void
  sectionOn: boolean
  onToggleSection: () => void
  measuring: boolean
  onToggleMeasure: () => void
  hasLevels: boolean
  sheet: PhoneSheet | null
  onToggleSheet: (sheet: PhoneSheet) => void
  edited: boolean
}

export function PhoneTools({
  placement,
  ready,
  onFit,
  cameraView,
  orthographic,
  onViewChange,
  onOrthographicChange,
  sectionOn,
  onToggleSection,
  measuring,
  onToggleMeasure,
  hasLevels,
  sheet,
  onToggleSheet,
  edited,
}: PhoneToolsProps): JSX.Element {
  const t = useTranslations(bimCopy)
  const dense = placement === 'side' ? 'h-12 pointer-coarse:h-12' : undefined

  return (
    <>
      <ViewerToolButton
        label={t('stage.home')}
        caption={t('stage.tool.fit')}
        icon={Home}
        disabled={!ready}
        onClick={onFit}
        className={dense}
      />
      <StageViewMenu
        trigger="tool"
        side={placement === 'side' ? 'right' : 'top'}
        view={cameraView}
        orthographic={orthographic}
        onViewChange={onViewChange}
        onOrthographicChange={onOrthographicChange}
        disabled={!ready}
      />
      <ViewerToolButton
        label={t('viewer.section.toggle')}
        icon={Scissors}
        active={sectionOn}
        disabled={!ready}
        onClick={onToggleSection}
        className={dense}
      />
      <ViewerToolButton
        label={t('viewer.measure.toggle')}
        icon={Ruler}
        active={measuring}
        disabled={!ready}
        onClick={onToggleMeasure}
        className={dense}
      />
      <ViewerToolButton
        label={t('stage.levels')}
        icon={Layers3}
        active={sheet === 'levels'}
        disabled={!hasLevels}
        onClick={() => onToggleSheet('levels')}
        className={dense}
      />
      <ViewerToolButton
        label={t('stage.tool.more')}
        icon={MoreHorizontal}
        active={sheet === 'more'}
        marked={edited && sheet !== 'more'}
        onClick={() => onToggleSheet('more')}
        className={dense}
      />
    </>
  )
}

export interface PhoneMoreRowsProps {
  ready: boolean
  canUndo: boolean
  onUndo: () => void
  onCapture: () => void
  captureFailed: boolean
  xray: boolean
  xrayHint: string | null
  xrayDisabled: boolean
  onToggleXray: () => void
  edited: boolean
  onShowEverything: () => void
  advancedDisabled: boolean
  onOpenAdvanced: () => void
}

export function PhoneMoreRows({
  ready,
  canUndo,
  onUndo,
  onCapture,
  captureFailed,
  xray,
  xrayHint,
  xrayDisabled,
  onToggleXray,
  edited,
  onShowEverything,
  advancedDisabled,
  onOpenAdvanced,
}: PhoneMoreRowsProps): JSX.Element {
  const t = useTranslations(bimCopy)
  return (
    <div className="flex flex-col gap-0.5 p-1.5" role="group" aria-label={t('stage.more')}>
      <ViewerRailItem
        label={t('stage.back')}
        toggle={false}
        icon={<Undo2 aria-hidden="true" />}
        disabled={!canUndo}
        onClick={onUndo}
      />
      <ViewerRailItem
        label={captureFailed ? t('viewer.capture.failed') : t('viewer.capture.action')}
        toggle={false}
        icon={captureFailed ? <MonitorX aria-hidden="true" /> : <Camera aria-hidden="true" />}
        disabled={!ready}
        onClick={onCapture}
      />
      <ViewerRailItem
        label={t('viewer.xray')}
        icon={<Eye aria-hidden="true" />}
        selected={xray}
        disabled={!ready || xrayDisabled}
        onClick={onToggleXray}
      />
      {xrayDisabled && xrayHint && (
        <p className="text-muted-foreground px-2 pb-1 text-xs">{xrayHint}</p>
      )}
      {edited && (
        <ViewerRailItem
          label={t('stage.showEverything')}
          toggle={false}
          icon={<Layers aria-hidden="true" />}
          onClick={onShowEverything}
        />
      )}
      <ViewerRailItem
        label={t('stage.advanced')}
        toggle={false}
        icon={<SlidersHorizontal aria-hidden="true" />}
        disabled={advancedDisabled}
        onClick={onOpenAdvanced}
      />
    </div>
  )
}
