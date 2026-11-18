export class TurnContextTiming {
  private readonly startedAt = performance.now()
  private readonly phases = new Map<string, { ms: number; desc?: string }>()

  async time<T>(name: string, load: () => Promise<T>): Promise<T> {
    const started = performance.now()
    try {
      return await load()
    } finally {
      this.phases.set(name, { ms: performance.now() - started, desc: this.phases.get(name)?.desc })
    }
  }

  describe(name: string, desc: string): void {
    const phase = this.phases.get(name)
    this.phases.set(name, { ms: phase?.ms ?? 0, desc })
  }

  header(): string {
    const dur = (ms: number) => Math.round(ms * 10) / 10
    const entries = [...this.phases].map(([name, { ms, desc }]) =>
      desc ? `${name};dur=${dur(ms)};desc="${desc}"` : `${name};dur=${dur(ms)}`,
    )
    return [...entries, `total;dur=${dur(performance.now() - this.startedAt)}`].join(', ')
  }
}
