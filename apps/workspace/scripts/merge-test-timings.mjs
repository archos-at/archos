#!/usr/bin/env node
// `bun test --update-timings` under `--shard` writes only that shard's files: one file per shard, merged here.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const [dir, out] = process.argv.slice(2)
const files = {}
for (const name of readdirSync(dir)) Object.assign(files, JSON.parse(readFileSync(path.join(dir, name), 'utf8')).files)
const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
writeFileSync(out, `${JSON.stringify({ version: 1, files: sorted }, null, 1)}\n`)
console.log(`${Object.keys(sorted).length} spec files timed`)
