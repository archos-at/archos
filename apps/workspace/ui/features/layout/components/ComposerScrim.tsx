export function ComposerScrim() {
  return (
    <div
      aria-hidden="true"
      data-testid="composer-floor-scrim"
      className="from-background pointer-events-none absolute inset-x-0 bottom-0 z-10 h-40 bg-gradient-to-t from-[5rem] to-transparent"
    />
  )
}
