import { mock } from 'bun:test'

mock.module('server-only', () => ({}))
mock.module('external-svg-loader', () => ({}))
mock.module('external-svg-loader/dist/svg-loader.min.js', () => ({}))
