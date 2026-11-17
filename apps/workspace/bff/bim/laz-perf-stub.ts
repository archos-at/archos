const MESSAGE =
  'laz-perf is stubbed out in this build (see bff/bim/laz-perf-stub.ts). ' +
  'Grid does not decode LAZ point clouds; remove the alias in next.config.ts to enable them.'

function unavailable(): never {
  throw new Error(MESSAGE)
}

export const createLazPerf = unavailable
export const LASZip = unavailable
export const ChunkDecoder = unavailable
export const DynamicLASZip = unavailable

export default unavailable
