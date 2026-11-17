export class SeededRandom {
  private seed: number

  constructor(seed: number) {
    this.seed = seed
  }

  next(): number {
    const x = Math.sin(this.seed++) * 10000
    return x - Math.floor(x)
  }

  reset(seed: number): void {
    this.seed = seed
  }
}
