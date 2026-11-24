export const Section = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <section id={id} data-card={id} className="flex flex-col gap-2">
    <h2 className="font-mono text-xs text-muted-foreground">{id}</h2>
    {children}
  </section>
)
