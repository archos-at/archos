#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { gzipSync } from 'node:zlib'
import { GeometryProcessor } from '@ifc-lite/geometry'

const STAIR_TYPES = /^Ifc(Stair|StairFlight|Railing|Ramp|RampFlight)/i
const megabytes = (bytes) => Math.round((bytes / 1e6) * 10) / 10
const seconds = (milliseconds) => Math.round(milliseconds / 100) / 10

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/measure-ifc-geometry-build.mjs <model.ifc>')
  process.exit(2)
}

const packageJson = JSON.parse(
  await readFile(new URL('../node_modules/@ifc-lite/geometry/package.json', import.meta.url), 'utf8')
)
const buffer = new Uint8Array(await readFile(file))

const geometry = new GeometryProcessor()
await geometry.init()
const startedAt = performance.now()

let meshes = 0
let batches = 0
let triangles = 0
let firstBatchMs = null
let longestBlockMs = 0
let rawBytes = 0
let stairBytes = 0
let lastEventAt = startedAt
const chunks = []

for await (const event of geometry.processStreaming(buffer)) {
  const now = performance.now()
  longestBlockMs = Math.max(longestBlockMs, now - lastEventAt)
  if (event.type === 'batch') {
    batches += 1
    firstBatchMs ??= now - startedAt
    for (const mesh of event.meshes) {
      const arrays = [mesh.positions, mesh.normals, mesh.indices]
      const bytes = arrays.reduce((total, array) => total + array.byteLength, 0)
      meshes += 1
      triangles += mesh.indices.length / 3
      rawBytes += bytes
      if (STAIR_TYPES.test(mesh.ifcType ?? '')) stairBytes += bytes
      for (const array of arrays) chunks.push(Buffer.from(array.buffer, array.byteOffset, array.byteLength))
    }
  }
  lastEventAt = performance.now()
}
const buildMs = performance.now() - startedAt
const rssAfterBuildMb = Math.round(process.memoryUsage().rss / 1e6)

console.log(
  JSON.stringify({
    file: file.split('/').pop(),
    node: process.version,
    cpus: availableParallelism(),
    geometryPackage: packageJson.version,
    path: 'processStreaming',
    ifcMb: megabytes(buffer.length),
    buildS: seconds(buildMs),
    firstBatchS: firstBatchMs === null ? null : seconds(firstBatchMs),
    longestBlockS: seconds(longestBlockMs),
    batches,
    meshes,
    triangles: Math.round(triangles),
    meshRawMb: megabytes(rawBytes),
    meshGzipMb: megabytes(gzipSync(Buffer.concat(chunks), { level: 6 }).length),
    stairTypesRawMb: megabytes(stairBytes),
    rssAfterBuildMb,
  })
)
