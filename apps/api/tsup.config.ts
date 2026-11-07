import { defineConfig } from 'tsup';

// @cqa/contracts is shipped as TypeScript source, so it must be bundled into the server build.
export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  noExternal: ['@cqa/contracts', '@cqa/evaluation'],
});
