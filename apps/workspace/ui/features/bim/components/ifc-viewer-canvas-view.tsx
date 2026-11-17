

import { cn } from '@/lib/utils'
import { REPLAY_BLOCK_CLASS } from '@/lib/analytics/posthog-config'

import type { IfcViewerCanvasController } from './use-ifc-viewer-canvas-controller'

export function IfcViewerCanvasView({ controller }: { controller: IfcViewerCanvasController }) {
  const { canvasRef, className, dragging, handleDoubleClick, handleKeyDown, handlePointerCancel, handlePointerDown, handlePointerMove, handlePointerUp, hovering, keysId, measuring, overlayLabelsRef, overlaySvgRef, setHovering, t } = controller
  return (
    <div className={cn('relative', REPLAY_BLOCK_CLASS, className)}>
      <canvas
        ref={canvasRef}
        className={cn(
          'size-full touch-none select-none [-webkit-touch-callout:none] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60',
          measuring
            ? 'cursor-crosshair'
            : dragging
              ? 'cursor-grabbing'
              : hovering
                ? 'cursor-pointer'
                : 'cursor-grab'
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={() => setHovering(false)}
        onDoubleClick={handleDoubleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={(event) => event.preventDefault()}
        tabIndex={0}
        role="img"
        aria-label={t('viewer.canvasLabel')}
        aria-describedby={keysId}
      />
      <p id={keysId} className="sr-only">
        {t('viewer.keyboardHint')}
      </p>
      <svg
        ref={overlaySvgRef}
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
        aria-hidden="true"
      />
      <div
        ref={overlayLabelsRef}
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden="true"
      />
    </div>
  )
}
