export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends ReadonlyArray<infer TElement>
    ? ReadonlyArray<DeepPartial<TElement>>
    : T extends Date
      ? T
      : T extends object
        ? { [K in keyof T]?: DeepPartial<T[K]> }
        : T

export type StoreSelector<TState> = (state: TState) => unknown

export const asStoreState = <TState>(fixture: DeepPartial<TState>): TState =>
  fixture as unknown as TState
