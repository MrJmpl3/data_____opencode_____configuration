import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: '@opentui/solid/jsx-runtime', replacement: `${root}test/support/opentui-memory-renderer.ts` },
      { find: '@opentui/solid/jsx-dev-runtime', replacement: `${root}test/support/opentui-memory-renderer.ts` },
    ],
  },
  plugins: [
    {
      name: 'quota-client-solid-build',
      enforce: 'pre',
      resolveId(id, importer) {
        if (id === 'solid-js' && (importer?.includes('/src/features/quota/') || importer?.includes('/test/support/'))) {
          return `${root}node_modules/solid-js/dist/solid.js`;
        }
        return undefined;
      },
    },
  ],
  test: {
    environment: 'node',
    allowOnly: false,
    coverage: {
      provider: 'v8',
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 95,
        lines: 95,
      },
      include: ['index.tsx', 'src/**/*.{ts,tsx}'],
      exclude: [
        '**/node_modules/**',
        '**/test/**',
        '**/tests/**',
        '**/*.{test,spec}.{ts,tsx}',
        '**/*.d.ts',
        '**/coverage/**',
      ],
    },
  },
});
