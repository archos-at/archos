#!/usr/bin/env node
import { registerHooks } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'typescript' || specifier.startsWith('typescript/')) {
      return nextResolve(`typescript-api${specifier.slice('typescript'.length)}`, context);
    }
    return nextResolve(specifier, context);
  },
});

process.argv = process.argv.map((arg) =>
  arg.startsWith('plugin:.') ? `plugin:${pathToFileURL(path.resolve(arg.slice('plugin:'.length))).href}` : arg
);

await import(new URL('../node_modules/dependency-cruiser/bin/dependency-cruiser.mjs', import.meta.url).href);
